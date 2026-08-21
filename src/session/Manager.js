import { SessionRegistry } from "./Registry.js";
import { createNewSession } from "./Creator.js";
import { sessionLogger } from "./Logger.js";
import { sessionPool } from "./Pool.js";
import { logger } from "#utils/logger.js";
import { getSessionState, cleanupSession as cleanupStalls } from "../stalls.js";
import { recordUnexpectedPageClose } from "./collapseDetector.js";

// Per-provider lock: prevents two concurrent createSession() calls from
// both doing a cold boot and opening duplicate tabs for the same provider.
const _creatingLocks = new Map(); // providerId → Promise

// Sliding TTL - resets on every access. Sessions that haven't been touched
// for this long are swept; actively-used sessions survive indefinitely.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 15 * 60 * 1000;
// Overridable for T-023's demonstration — reproducing a collapse and waiting
// out a real 5-minute GC tick is possible but needlessly slow to verify.
const GC_INTERVAL_MS = Number(process.env.GC_INTERVAL_MS) || 5 * 60 * 1000;

export class SessionManager {
  constructor() {
    this.registry = new SessionRegistry();
    // In test environment, skip the GC interval to allow Node to exit cleanly.
    if (process.env.NODE_ENV !== "test") {
      this.gcInterval = setInterval(
        () => this._cleanupStaleSessions(),
        GC_INTERVAL_MS,
      );
    } else {
      this.gcInterval = null;
    }
  }

  async _cleanupStaleSessions() {
    const now = Date.now();
    for (const session of this.registry.list()) {
      // Close sessions whose browser tab is already gone — no point keeping them.
      if (session.page?.isClosed?.()) {
        logger.info(
          `[SessionManager] GC sweeping session with closed tab: ${session.id}`,
        );
        recordUnexpectedPageClose();
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
    const idleSessions = this.registry
      .list()
      .filter((s) => s.providerId === providerId && !s.locked);
    if (idleSessions.length > 0) {
      logger.info(
        `[SessionManager] Closing ${idleSessions.length} idle ${providerId} session(s) before creating new one`,
      );
      for (const s of idleSessions) {
        await this.closeSession(s.id).catch(() => {});
      }
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

    this.registry.add(session.id, {
      ...session,
      locked: false,
      lastUsedAt: Date.now(),
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
      recordUnexpectedPageClose();
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
