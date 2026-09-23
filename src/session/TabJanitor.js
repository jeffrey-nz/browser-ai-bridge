//[[ ONE TIDY TAB SET, WHATEVER THE CALLERS DO.
//
//   The design is one warm tab per provider (see CLAUDE.md "Session lifecycle"),
//   but nothing ENFORCED an upper bound, and on 2026-09-13 a single Chrome held
//   28 pages — 17 of them chatgpt.com — while reader-scripts generated books.
//   Every one was a registered session; none was a mystery orphan. They piled up
//   from three ordinary things:
//
//     1. clients that die without DELETE /api/sessions/:id (reader-scripts'
//        exit handler fired the request and called process.exit in the same
//        tick, so it never left the process; every runner restart leaked);
//     2. abandoned turns — a race loser, or a caller whose HTTP timeout fired —
//        which kept their tab busy. A throttled ChatGPT turn sat in a 90s → 300s
//        back-off and RE-SUBMITTED the prompt after each wait for a caller that
//        was already gone, adding load to the very account that was throttled;
//     3. a 15-minute idle TTL with no per-provider ceiling.
//
//   Too many tabs is not just untidy: many live sessions from one account is
//   the pattern that earns "Too many requests". So this sweeps on a short
//   interval and keeps each provider to a small, predictable set.
//
//   WHAT IT NEVER TOUCHES. Only pages whose URL belongs to a known AI provider,
//   plus surplus blank/new-tab pages, are candidates. Any other tab in the same
//   Chrome — App Store Connect sessions driven by other tools, itch.io, anything
//   a person opened — is left alone. A LOCKED session (a turn in progress with a
//   caller still attached) is never closed.
//
//   The decisions live in planCleanup(), a pure function, so they are unit-
//   tested without a browser (tests/tabJanitor.test.js). ]]

import process from "node:process";
import { logger } from "#utils/logger.js";
import { GENERIC_SPECS } from "#ai/generic/specs.js";
import { isCopilotUrl } from "#ai/copilot/client/navigation.js";

export const LIMITS = {
  // Registered sessions a provider may hold, pool tab not included.
  maxSessionsPerProvider: Number(process.env.MAX_TABS_PER_PROVIDER ?? 3),
  // An idle session younger than this is never evicted for being over the cap —
  // a batch client reuses its session between turns seconds apart.
  idleGraceMs: Number(process.env.TAB_IDLE_GRACE_MS ?? 90_000),
  // A locked session whose caller has gone and which has held its lock this
  // long is an abandoned turn.
  abandonedTurnMs: Number(process.env.ABANDONED_TURN_MS ?? 5 * 60_000),
  // Blank / new-tab pages kept around (one is harmless and lets Chrome stay open).
  maxBlankPages: Number(process.env.MAX_BLANK_TABS ?? 1),
  // A provider tab must look orphaned this long before it is closed. A session
  // being CREATED opens its page seconds before it is registered (initialize →
  // startNewChat → setMode → registry.add), and must not be mistaken for one.
  orphanGraceMs: Number(process.env.TAB_ORPHAN_GRACE_MS ?? 150_000),
  // A warm standby tab is closed after this long unused, but only while its
  // provider has no registered sessions — an active provider keeps its standby.
  poolIdleMs: Number(process.env.TAB_POOL_IDLE_MS ?? 10 * 60_000),
};

const BUILTIN_MATCHERS = {
  chatgpt: (u) => u.includes("chatgpt.com"),
  gemini: (u) => u.includes("gemini.google.com"),
  deepseek: (u) => u.includes("deepseek.com"),
  grok: (u) => u.includes("x.com/i/grok") || u.includes("grok.com"),
  copilot: (u) => {
    try {
      return isCopilotUrl(u);
    } catch {
      return false;
    }
  },
};

/** The provider id a page URL belongs to, or null for any non-provider page. */
export function providerForUrl(url) {
  const u = String(url || "");
  for (const [id, match] of Object.entries(BUILTIN_MATCHERS)) {
    if (match(u)) return id;
  }
  for (const spec of Object.values(GENERIC_SPECS)) {
    try {
      if (spec.urlMatch && spec.urlMatch(u)) return spec.id;
    } catch {
      /* a spec matcher throwing is not a reason to close anything */
    }
  }
  return null;
}

export function isBlankUrl(url) {
  const u = String(url || "");
  return u === "" || u === "about:blank" || u.startsWith("chrome://newtab") || u.startsWith("chrome://new-tab-page");
}

/**
 * Decide what to close. Pure: no browser, no clock of its own.
 *
 * @param {object} input
 * @param {Array<{id, providerId, locked, clientGone, lockedAt, lastUsedAt, createdAt}>} input.sessions  registered sessions
 * @param {Array<{key, url}>} input.pages   every open page; `key` is how the runner finds it again
 * @param {Set} input.ownedPageKeys          page keys held by a registered session OR the warm pool
 * @param {number} input.now
 * @param {object} [input.limits]
 * @returns {{ closeSessions: Array<{id, reason}>, closePages: Array<{key, reason}> }}
 */
export function planCleanup({ sessions, pages, ownedPageKeys, now, limits = LIMITS, orphanSince = new Map(), poolEntries = [] }) {
  const closeSessions = [];
  const closePages = [];
  const closePool = [];
  const closing = new Set();

  // 1. Abandoned turns: caller gone, lock held past the limit.
  for (const s of sessions) {
    if (s.locked && s.clientGone && s.lockedAt && now - s.lockedAt > limits.abandonedTurnMs) {
      closeSessions.push({ id: s.id, reason: `abandoned turn (caller gone ${Math.round((now - s.lockedAt) / 1000)}s)` });
      closing.add(s.id);
    }
  }

  //[[ 1b. STALE LOCKS — a lock nothing will ever release.
  //   Rule 1 above needs `clientGone`, which only ask.js sets when the HTTP caller
  //   disconnects. A lock stranded any other way — most often a cleanup that hung
  //   on a wedged page (see withSessionLock) — has clientGone false forever, and
  //   rule 2 below skips it for being locked. Such a session is unreclaimable by
  //   every existing rule, which is how qwen came to hold 7 sessions against a cap
  //   of 3 with 9 tabs open (2026-09-23), each idle for minutes and still locked.
  //
  //   DURATION IS THE ONLY SAFE DISCRIMINATOR, and the first attempt at this rule
  //   got it wrong. It also required the session to be idle past abandonedTurnMs,
  //   on the assumption that a live turn keeps `lastUsedAt` fresh. It does not:
  //   Manager.getSession() bumps lastUsedAt when a session is ACQUIRED, and a turn
  //   then runs for minutes without touching it again. A real ten-minute
  //   generation therefore looks exactly like a dead lock, and that rule would
  //   have closed live turns mid-answer — caught by tabJanitor's own
  //   "a live locked turn is not [closed]" test, which was right.
  //
  //   So the test is simply "held longer than any turn can possibly last". The
  //   client aborts its own ask well before this (ChatGPTAcquirer's
  //   BOOK_ASK_TIMEOUT_MS is clamped to 30 minutes at the very most), so a lock
  //   still held at 45 minutes is not a slow turn by any reading. ]]
  const staleLockMs = limits.staleLockMs ?? 45 * 60 * 1000;
  for (const s of sessions) {
    if (closing.has(s.id)) continue;
    if (!s.locked || !s.lockedAt) continue;
    const lockedFor = now - s.lockedAt;
    if (lockedFor > staleLockMs) {
      closeSessions.push({
        id: s.id,
        reason: `stale lock (${s.providerId}, locked ${Math.round(lockedFor / 60000)}m — longer than any turn can run, nothing will release it)`,
      });
      closing.add(s.id);
    }
  }

  // 2. Per-provider ceiling: evict least-recently-used IDLE sessions beyond grace.
  const byProvider = new Map();
  for (const s of sessions) {
    if (closing.has(s.id)) continue;
    if (!byProvider.has(s.providerId)) byProvider.set(s.providerId, []);
    byProvider.get(s.providerId).push(s);
  }
  for (const [providerId, list] of byProvider) {
    let over = list.length - limits.maxSessionsPerProvider;
    if (over <= 0) continue;
    const evictable = list
      .filter((s) => !s.locked)
      .map((s) => ({ s, lastUsed: s.lastUsedAt ?? new Date(s.createdAt).getTime() }))
      .filter(({ lastUsed }) => now - lastUsed > limits.idleGraceMs)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const { s, lastUsed } of evictable) {
      if (over <= 0) break;
      closeSessions.push({ id: s.id, reason: `${providerId} over cap of ${limits.maxSessionsPerProvider} (idle ${Math.round((now - lastUsed) / 1000)}s)` });
      over--;
    }
  }

  // 3. Orphan provider pages: a provider tab no session or pool entry holds.
  // 4. Surplus blank pages.
  let blanks = 0;
  for (const p of pages) {
    if (ownedPageKeys.has(p.key)) continue;
    if (isBlankUrl(p.url)) {
      blanks++;
      if (blanks > limits.maxBlankPages) closePages.push({ key: p.key, reason: "surplus blank tab" });
      continue;
    }
    const provider = providerForUrl(p.url);
    const since = orphanSince.get(p.key);
    if (provider && since !== undefined && now - since > limits.orphanGraceMs) {
      closePages.push({ key: p.key, reason: `orphan ${provider} tab (no session or pool entry for ${Math.round((now - since) / 1000)}s)` });
    }
    // anything else is not ours — never closed
  }

  // 5. Standby tabs for providers nobody is using any more.
  const activeProviders = new Set(sessions.map((s) => s.providerId));
  for (const e of poolEntries) {
    if (activeProviders.has(e.providerId)) continue;
    if (e.pooledAt && now - e.pooledAt > limits.poolIdleMs) {
      closePool.push({ providerId: e.providerId, id: e.id, reason: `${e.providerId} standby unused ${Math.round((now - e.pooledAt) / 60000)}m` });
    }
  }

  return { closeSessions, closePages, closePool };
}

/** Per-provider census for GET /api/tabs and the sweep log line. */
export function census({ sessions, pages, ownedPageKeys, poolCounts }) {
  const out = {};
  const bump = (p, k) => {
    out[p] = out[p] || { sessions: 0, locked: 0, abandoned: 0, pool: poolCounts?.[p] || 0, orphanTabs: 0 };
    out[p][k]++;
  };
  for (const s of sessions) {
    bump(s.providerId, "sessions");
    if (s.locked) bump(s.providerId, "locked");
    if (s.locked && s.clientGone) bump(s.providerId, "abandoned");
  }
  let blank = 0;
  let other = 0;
  for (const p of pages) {
    if (isBlankUrl(p.url)) { blank++; continue; }
    const provider = providerForUrl(p.url);
    if (!provider) { other++; continue; }
    if (!ownedPageKeys.has(p.key)) bump(provider, "orphanTabs");
    else if (!out[provider]) out[provider] = { sessions: 0, locked: 0, abandoned: 0, pool: poolCounts?.[provider] || 0, orphanTabs: 0 };
  }
  return { totalPages: pages.length, blankTabs: blank, otherTabs: other, providers: out };
}

/**
 * Live runner: gathers state from the manager, pool and browser context, then
 * applies planCleanup(). Errors are logged, never thrown — a janitor that can
 * crash the bridge is worse than a messy tab strip.
 */
// page object → when this process first saw it unowned. WeakMap so a closed
// page drops out on its own.
const orphanFirstSeen = new WeakMap();

export async function sweep({ manager, pool, getContext, log = logger }) {
  try {
    const { context } = await getContext();
    const livePages = context.pages();
    const keyOf = new Map(livePages.map((pg, i) => [pg, `p${i}`]));
    const pages = livePages.map((pg) => {
      let url = "";
      try { url = pg.url(); } catch { /* detached */ }
      return { key: keyOf.get(pg), url };
    });

    const registry = manager.registry.list();
    const ownedPageKeys = new Set();
    for (const s of registry) if (s.page && keyOf.has(s.page)) ownedPageKeys.add(keyOf.get(s.page));
    const poolCounts = {};
    for (const [providerId, list] of pool.warmSessions.entries()) {
      poolCounts[providerId] = list.length;
      for (const s of list) if (s.page && keyOf.has(s.page)) ownedPageKeys.add(keyOf.get(s.page));
    }

    const sessions = registry.map((s) => ({
      id: s.id,
      providerId: s.providerId,
      locked: !!s.locked,
      clientGone: !!s.clientGone,
      lockedAt: s.lockedAt || null,
      lastUsedAt: s.lastUsedAt || null,
      createdAt: s.createdAt,
    }));

    const now = Date.now();
    const orphanSince = new Map();
    for (const pg of livePages) {
      const key = keyOf.get(pg);
      if (ownedPageKeys.has(key)) { orphanFirstSeen.delete(pg); continue; }
      if (!orphanFirstSeen.has(pg)) orphanFirstSeen.set(pg, now);
      orphanSince.set(key, orphanFirstSeen.get(pg));
    }

    const poolEntries = [];
    for (const [providerId, list] of pool.warmSessions.entries()) {
      for (const e of list) poolEntries.push({ providerId, id: e.id, pooledAt: e.pooledAt || null });
    }

    const plan = planCleanup({ sessions, pages, ownedPageKeys, now, orphanSince, poolEntries });
    if (!plan.closeSessions.length && !plan.closePages.length && !plan.closePool.length) return plan;

    const before = pages.length;
    for (const c of plan.closeSessions) {
      const s = manager.registry.get(c.id);
      if (s) {
        s.closedByBridge = true; // our close, not a browser collapse (T-023)
        // An abandoned locked turn must not be recycled into the pool mid-flight.
        if (s.locked) {
          s.locked = false;
          await manager.closeSession(c.id).catch(() => {});
          s.engine?.close?.().catch(() => {});
        } else {
          await manager.closeSession(c.id).catch(() => {});
        }
      }
    }
    const pageByKey = new Map(livePages.map((pg) => [keyOf.get(pg), pg]));
    for (const c of plan.closePages) {
      const pg = pageByKey.get(c.key);
      if (pg && !pg.isClosed()) await pg.close().catch(() => {});
    }

    for (const c of plan.closePool) {
      const list = pool.warmSessions.get(c.providerId) || [];
      const i = list.findIndex((e) => e.id === c.id);
      if (i >= 0) {
        const [entry] = list.splice(i, 1);
        await entry.engine?.close?.().catch(() => {});
      }
    }

    const reasons = [...plan.closeSessions, ...plan.closePages, ...plan.closePool].map((c) => c.reason);
    log.info(`[Tabs] Tidied ${reasons.length} (pages ${before} → ${context.pages().length}): ${reasons.join("; ")}`);
    return plan;
  } catch (err) {
    log.warn(`[Tabs] Sweep failed: ${err.message}`);
    return null;
  }
}

//[[ ONLY THE BRIDGE SERVER SWEEPS.
//
//   The first wiring started this interval in SessionManager's constructor. On
//   2026-09-13 a one-off `node -e "import('./src/session/Manager.js')"` — an
//   import smoke test — therefore became a SECOND janitor: its own empty
//   registry, connected to the live Chrome, which counted every AI tab as an
//   orphan and closed 20 of the running bridge's tabs, then kept sweeping every
//   minute until killed. Importing a module must never act on the browser. The
//   interval starts here, and src/index.js is the only caller. ]]
let janitorInterval = null;
export function startTabJanitor({ manager, pool, getContext, intervalMs = Number(process.env.TAB_SWEEP_INTERVAL_MS) || 60_000 }) {
  if (janitorInterval) return janitorInterval;
  janitorInterval = setInterval(() => sweep({ manager, pool, getContext }), intervalMs);
  janitorInterval.unref?.();
  logger.info(`[Tabs] Janitor on: ≤${LIMITS.maxSessionsPerProvider} sessions per provider, orphan grace ${LIMITS.orphanGraceMs / 1000}s, sweep every ${intervalMs / 1000}s`);
  return janitorInterval;
}

export function isTabJanitorRunning() {
  return janitorInterval !== null;
}

export function stopTabJanitor() {
  if (janitorInterval) clearInterval(janitorInterval);
  janitorInterval = null;
}

