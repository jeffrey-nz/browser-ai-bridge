import { SessionRegistry } from "./Registry.js";
import { createNewSession } from "./Creator.js";
import { sessionLogger } from "./Logger.js";
import { sessionPool } from "./Pool.js";
import { LIMITS as TAB_LIMITS } from "./TabJanitor.js";
import { logger } from "#utils/logger.js";
import { getSessionState, cleanupSession as cleanupStalls } from "../stalls.js";
import {
  recordUnexpectedPageClose,
  recordFreshSessionCreated,
} from "./collapseDetector.js";

// Per-provider lock: prevents two concurrent createSession() calls from
// both doing a cold boot and opening duplicate tabs for the same provider.
const _creatingLocks = new Map(); // providerId → Promise

// How long a caller waits for a busy provider to free a session before giving up.
// Longer than a typical turn, shorter than the poll budget that bounds the worst one.
const CAPACITY_WAIT_MS = Number(process.env.SESSION_CAPACITY_WAIT_MS ?? 120000);

// Sliding TTL - resets on every access. Sessions that haven't been touched
// for this long are swept; actively-used sessions survive indefinitely.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 15 * 60 * 1000;
// Overridable for T-023's demonstration — reproducing a collapse and waiting
// out a real 5-minute GC tick is possible but needlessly slow to verify.
const GC_INTERVAL_MS = Number(process.env.GC_INTERVAL_MS) || 5 * 60 * 1000;

export class SessionManager {
  constructor() {
    this.registry = new SessionRegistry();
    // The standby pool opens real tabs and must stay inside the same
    // per-provider ceiling; it cannot import the registry without a cycle.
    sessionPool.countLive = (providerId) =>
      this.registry.list().filter((s) => s.providerId === providerId).length;
    // In test environment, skip the GC interval to allow Node to exit cleanly.
    if (process.env.NODE_ENV !== "test") {
      this.gcInterval = setInterval(
        () => this._cleanupStaleSessions(),
        GC_INTERVAL_MS,
      );
    } else {
      this.gcInterval = null;
    }
    // The tab janitor is NOT started here — see startTabJanitor() in
    // TabJanitor.js, called only by the server's own boot (src/index.js).
  }

  async _cleanupStaleSessions() {
    const now = Date.now();
    for (const session of this.registry.list()) {
      // Close sessions whose browser tab is already gone — no point keeping them.
      if (session.page?.isClosed?.()) {
        logger.info(
          `[SessionManager] GC sweeping session with closed tab: ${session.id}`,
        );
        // T-023: a close THIS PROCESS asked for (ask.js/askOne.js closing a
        // stuck tab after "Failed to submit prompt", marked via
        // closedByBridge before calling page.close()) is not evidence of a
        // browser-side collapse — skip recording it as one.
        if (!session.closedByBridge) recordUnexpectedPageClose();
        await this.closeSession(session.id);
        continue;
      }
      const lastUsed = session.lastUsedAt ?? session.createdAt.getTime();
      if (now - lastUsed > SESSION_TTL_MS && !session.locked) {
        logger.info(
          `[SessionManager] GC sweeping idle session: ${session.id} (idle ${Math.round((now - lastUsed) / 60000)}m)`,
        );
        await this.closeSession(session.id);
      }
    }
  }

  async createSession(providerId, mode = null) {
    // Serialise cold-boot per provider: if another caller is already spinning
    // up a new tab for this provider, wait for it to finish rather than
    // opening a second tab in parallel.
    if (_creatingLocks.has(providerId)) {
      await _creatingLocks.get(providerId);
    }

    // Before opening a new tab, close any idle (unlocked) sessions for this
    // provider that are left over from prior runs killed without cleanup.
    // Prevents DeepSeek tab accumulation when agent-core is restarted frequently.
    // Only sessions idle past the grace window: a live batch client sits
    // unlocked for a few seconds BETWEEN its turns, and closing that session
    // made it fail with "Session expired or invalid", reset, and open yet
    // another tab — the churn this sweep was meant to prevent. Dead clients'
    // sessions are well past the grace window, and TabJanitor caps the rest.
    const idleSessions = this.registry
      .list()
      .filter(
        (s) =>
          s.providerId === providerId &&
          !s.locked &&
          Date.now() - (s.lastUsedAt ?? s.createdAt.getTime()) > TAB_LIMITS.idleGraceMs,
      );
    if (idleSessions.length > 0) {
      logger.info(
        `[SessionManager] Closing ${idleSessions.length} idle ${providerId} session(s) before creating new one`,
      );
      for (const s of idleSessions) {
        await this.closeSession(s.id).catch(() => {});
      }
    }

    //[[ THE PER-PROVIDER CAP WAS A CLEANING RULE, NOT A LIMIT.
    //
    //   MAX_TABS_PER_PROVIDER lived only in TabJanitor, which SWEEPS — and its
    //   over-cap rule can only evict sessions that are NOT locked. Nothing capped
    //   CREATION, so while every session for a provider was busy, each new
    //   request simply opened another tab. The ceiling was therefore only ever
    //   enforced against providers that were already idle, which is exactly when
    //   it was not needed.
    //
    //   Measured 2026-09-24 generating tl-en/learn-tagalog, with the race reduced
    //   to a single primary so there were no losers at all: tabs climbed 19 -> 30
    //   over five minutes, with gemini, chatgpt and perplexity each holding five
    //   to seven sessions, every one LOCKED, against a stated cap of 3. Reducing
    //   racers had not helped because racing was never the source.
    //
    //   So a caller that arrives when the provider is full WAITS for a session to
    //   free instead of opening one more. Waiting is the right answer rather than
    //   refusing: the bridge is a queue in front of a browser, and the work is
    //   not urgent enough to be worth a second tab. If nothing frees within the
    //   budget the error is explicit, and the client's own cycle/retry treats it
    //   as a transient failure and moves on.
    //
    //   FIRST ATTEMPT HAD A HOLE, and the tabs kept growing through it: it only
    //   waited when the provider was at capacity AND had no unlocked session,
    //   on the reasoning that a free one could be reused. Nothing here reuses a
    //   registry session — the idle sweep above CLOSES them and sessionPool is a
    //   separate standby pool — so one unlocked session let every new request
    //   past the cap. Measured after that fix shipped: chatgpt 5 sessions and
    //   perplexity 4, against a cap of 3. The condition is now capacity alone,
    //   and the loop reaps idle sessions as they age out so the wait can end. ]]
    const sessionsFor = () =>
      this.registry.list().filter((s) => s.providerId === providerId);
    const atCapacity = () =>
      sessionsFor().length >= TAB_LIMITS.maxSessionsPerProvider;
    //[[ An unlocked session past the grace window is capacity waiting to be
    //   reclaimed, so free it rather than waiting on it. Re-run inside the loop:
    //   a session that is merely BETWEEN turns becomes reclaimable as it ages. ]]
    const reapIdle = async () => {
      const idle = sessionsFor().filter(
        (x) =>
          !x.locked &&
          Date.now() - (x.lastUsedAt ?? x.createdAt.getTime()) >
            TAB_LIMITS.idleGraceMs,
      );
      for (const x of idle) await this.closeSession(x.id).catch(() => {});
      return idle.length;
    };

    if (atCapacity()) {
      const waitedFrom = Date.now();
      logger.warn(
        `[SessionManager] ${providerId} is at its cap of ${TAB_LIMITS.maxSessionsPerProvider} sessions — waiting for one instead of opening another tab.`,
      );
      while (atCapacity() && Date.now() - waitedFrom < CAPACITY_WAIT_MS) {
        if (!(await reapIdle())) await new Promise((r) => setTimeout(r, 500));
      }
      if (atCapacity()) {
        const err = new Error(
          `${providerId} is at its session cap (${TAB_LIMITS.maxSessionsPerProvider}) and none became free within ${Math.round(CAPACITY_WAIT_MS / 1000)}s`,
        );
        err.status = 503;
        throw err;
      }
      logger.info(
        `[SessionManager] ${providerId} freed a session after ${Math.round((Date.now() - waitedFrom) / 1000)}s — no extra tab opened.`,
      );
    }

    let session = sessionPool.acquire(providerId);

    if (!session) {
      let resolve;
      const lock = new Promise((r) => {
        resolve = r;
      });
      _creatingLocks.set(providerId, lock);
      try {
        session = await createNewSession(providerId);
      } finally {
        _creatingLocks.delete(providerId);
        resolve();
      }
    }

    // Always start a fresh chat regardless of pool vs cold-boot origin.
    // Pool sessions are pre-warmed with startNewChat(), but may have accumulated
    // stale conversation state between warmup and acquisition (e.g. another
    // browser task ran in the same tab). Calling it here is cheap (~3s) and
    // guarantees a clean context for every caller.
    try {
      if (typeof session.engine?.startNewChat === "function") {
        await session.engine.startNewChat();
      }

      if (mode && typeof session.engine?.setMode === "function") {
        await session.engine
          .setMode(mode)
          .catch((err) =>
            logger.warn(
              `[SessionManager] setMode(${mode}) failed: ${err.message}`,
            ),
          );
      }

      // Provider-specific mode defaults for automation workloads.
      // Translation, definition, and alignment prompts are structured JSON-batch
      // tasks — they don't need reasoning/thinking modes.  Reasoning modes make
      // completion polls time out and yield truncated JSON ("6 of 25 keys").
      // Callers can still override by passing an explicit mode.
      const autoModeDefaults = {
        gemini: "fast", // Flash — not Pro (thinking times out on batches)
        deepseek: "fast", // Standard V3 — not DeepThink R1
        grok: "fast", // Standard — not Grok Reasoning
      };
      const defaultMode = autoModeDefaults[providerId];
      if (
        defaultMode &&
        !mode &&
        typeof session.engine?.setMode === "function"
      ) {
        mode = defaultMode;
        await session.engine
          .setMode(mode)
          .catch((err) =>
            logger.warn(
              `[SessionManager] setMode(${mode}) failed for ${providerId}: ${err.message}`,
            ),
          );
      }
    } catch (err) {
      // startNewChat (or setMode) failed — close the tab so we don't leak the
      // browser page. Pool replenishment was already triggered by acquire().
      logger.warn(
        `[SessionManager] Session setup failed for ${providerId}: ${err.message} — closing tab`,
      );
      session.engine?.close?.().catch(() => {});
      throw err;
    }

    logger.info(
      `[SessionManager] Session ${session.id} created for provider ${providerId} with mode ${mode || "none"}`,
    );

    // T-023: reset here, not only in Creator.js's cold-boot path — a POOL
    // HIT never touches Creator.js at all, so a collapse's sticky flag would
    // otherwise stay set while the bridge is already back to handing out
    // working sessions from the pool. startNewChat() above just proved this
    // session's page is alive and drivable, cold-booted or not.
    recordFreshSessionCreated();

    this.registry.add(session.id, {
      ...session,
      locked: false,
      lastUsedAt: Date.now(),
      // T-028: closedByBridge must not ride along into a session that is
      // about to be handed out for a fresh turn. session.page?.close() at
      // the two ask.js/askOne.js mark sites is fire-and-forget (not
      // awaited), so _recycleOrClose's !session.page?.isClosed() check can
      // race it and push a marked-but-not-yet-closed session back into the
      // pool — the pool hit above would then acquire it, its `...session`
      // spread would carry closedByBridge:true forward, and every future
      // genuine page death on THIS registry entry would be silently
      // skipped from then on. Explicit false here, after the spread, so it
      // always wins over whatever the source session carried.
      closedByBridge: false,
      // T-061: turnCount/createdAt are set once, in Creator.js's cold-boot
      // path only (turnCount: 0, createdAt: new Date()) — a POOL HIT here
      // never goes through Creator.js, same shape T-023 fixed two lines up
      // for the collapse flag. Measured live: after a recycled session came
      // back under the same id, the chat itself WAS genuinely empty
      // (startNewChat() above did its job — a DOM conversation-turn count
      // right after reacquire read 0), but the next /api/ask still reported
      // turnIndex 2 and this object's original sessionAgeMs, because the
      // spread above carried the PREVIOUS caller's turnCount/createdAt
      // straight through. The chat resets; the bridge's own bookkeeping of
      // it did not. Explicit override, same reasoning as closedByBridge.
      turnCount: 0,
      createdAt: new Date(),
    });

    return session.id;
  }

  logTranscript(sessionId, role, content, metadata = {}) {
    const session = this.registry.get(sessionId);
    if (session) {
      sessionLogger.logTranscript(session.logPath, role, content, metadata);
    }
  }

  getSession(sessionId) {
    const session = this.registry.get(sessionId);
    if (!session) return null;

    if (!session.page || session.page.isClosed()) {
      // T-023: see the matching comment in _cleanupStaleSessions — a close we
      // asked for ourselves isn't a collapse.
      if (!session.closedByBridge) recordUnexpectedPageClose();
      this.closeSession(sessionId);
      return null;
    }

    // Sliding TTL: bump lastUsedAt on every access so active sessions
    // never expire while work is in progress.
    const now = Date.now();
    const lastUsed = session.lastUsedAt ?? session.createdAt.getTime();
    if (now - lastUsed > SESSION_TTL_MS) {
      logger.info(
        `[SessionManager] Session ${sessionId.slice(0, 8)} expired after ${Math.round((now - lastUsed) / 60000)}m idle.`,
      );
      this.closeSession(sessionId);
      return null;
    }
    session.lastUsedAt = now;

    return session;
  }

  async closeSession(sessionId) {
    const session = this.registry.get(sessionId);
    if (session) {
      const wasStalled = getSessionState(sessionId) === "stalled";
      cleanupStalls(sessionId);
      sessionLogger.finalize(session.logPath);
      this.registry.delete(sessionId);
      await this._recycleOrClose(session, wasStalled);
      return true;
    }
    return false;
  }

  async _recycleOrClose(session, wasStalled = false) {
    const pool = sessionPool;
    const poolSize = Number(process.env.POOL_SIZE ?? 1);
    const currentPool = pool.warmSessions.get(session.providerId);
    if (wasStalled) {
      logger.info(
        `[SessionManager] Session ${session.id.slice(0, 8)} was stalled — closing tab instead of recycling.`,
      );
    }
    const canRecycle =
      !pool.isShuttingDown &&
      !wasStalled &&
      currentPool &&
      currentPool.length < poolSize &&
      !pool._warming.has(session.providerId) &&
      !session.page?.isClosed();

    if (canRecycle) {
      // Return immediately to pool in its current state. createSession() always
      // calls startNewChat() on acquire, so no need to navigate now. Pushing
      // immediately (rather than after a navigation) prevents a concurrent
      // createSession from seeing an empty pool and spawning a new tab.
      session.pooledAt = Date.now(); // TabJanitor expires long-unused standbys
      currentPool.push(session);
      logger.info(
        `[SessionManager] ♻️ Recycled ${session.providerId} tab back to pool.`,
      );
    } else {
      if (session.engine && typeof session.engine.close === "function") {
        await session.engine
          .close()
          .catch((e) =>
            logger.error(`[SessionManager] Cleanup error: ${e.message}`),
          );
      }
    }
  }

  async closeAllSessions() {
    clearInterval(this.gcInterval);
    await sessionPool.shutdown();
    const sessions = this.registry.list();
    for (const session of sessions) {
      await this.closeSession(session.id);
    }
  }

  listSessions() {
    return this.registry.list().map((s) => ({
      id: s.id,
      providerId: s.providerId,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt ?? null,
      state: getSessionState(s.id),
      // T-003: read directly, not through getSession() — that call self-prunes
      // a dead-page session on access, which is exactly the state a health
      // check needs to see rather than have hidden from it.
      pageAttached: !!(s.page && !s.page.isClosed()),
    }));
  }
}
