import { test } from "node:test";
import assert from "node:assert/strict";
import { planCleanup, providerForUrl, census } from "../src/session/TabJanitor.js";

/**
 * Tab management (2026-09-13): one Chrome reached 28 pages, 17 of them
 * chatgpt.com, every one a registered session left by dead clients and
 * abandoned turns. planCleanup() decides what to close; these pin the rules —
 * above all the two it must never break: a locked turn with a caller still
 * attached is never closed, and a tab that isn't an AI provider's is never
 * touched.
 */

const NOW = 10_000_000;
const LIMITS = { maxSessionsPerProvider: 3, idleGraceMs: 90_000, abandonedTurnMs: 300_000, maxBlankPages: 1, orphanGraceMs: 150_000, poolIdleMs: 600_000 };
const sess = (id, providerId, extra = {}) => ({ id, providerId, locked: false, clientGone: false, lockedAt: null, lastUsedAt: NOW - 600_000, createdAt: new Date(NOW - 900_000), ...extra });

test("provider URL recognition covers built-in and generic providers, and nothing else", () => {
  assert.equal(providerForUrl("https://chatgpt.com/c/abc"), "chatgpt");
  assert.equal(providerForUrl("https://gemini.google.com/app"), "gemini");
  assert.equal(providerForUrl("https://www.kimi.ai/?chat_enter_method=new_chat"), "kimi");
  assert.equal(providerForUrl("https://appstoreconnect.apple.com/apps/123/distribution"), null);
  assert.equal(providerForUrl("https://itch.io/dashboard"), null);
});

test("over the per-provider cap, the least-recently-used idle sessions are closed", () => {
  const sessions = [
    sess("a", "chatgpt", { lastUsedAt: NOW - 900_000 }),
    sess("b", "chatgpt", { lastUsedAt: NOW - 800_000 }),
    sess("c", "chatgpt", { lastUsedAt: NOW - 700_000 }),
    sess("d", "chatgpt", { lastUsedAt: NOW - 600_000 }),
    sess("e", "chatgpt", { lastUsedAt: NOW - 500_000 }),
  ];
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: LIMITS });
  assert.deepEqual(plan.closeSessions.map((c) => c.id), ["a", "b"]);
});

test("a locked session is never evicted for the cap, and neither is a recently used one", () => {
  const sessions = [
    sess("locked1", "chatgpt", { locked: true, lockedAt: NOW - 10_000 }),
    sess("locked2", "chatgpt", { locked: true, lockedAt: NOW - 10_000 }),
    sess("fresh", "chatgpt", { lastUsedAt: NOW - 5_000 }),
    sess("old", "chatgpt", { lastUsedAt: NOW - 600_000 }),
    sess("locked3", "chatgpt", { locked: true, lockedAt: NOW - 10_000 }),
  ];
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: LIMITS });
  assert.deepEqual(plan.closeSessions.map((c) => c.id), ["old"]);
});

test("an abandoned turn (caller gone, lock held too long) is closed; a live locked turn is not", () => {
  const sessions = [
    sess("abandoned", "chatgpt", { locked: true, clientGone: true, lockedAt: NOW - 400_000 }),
    sess("recentlyGone", "chatgpt", { locked: true, clientGone: true, lockedAt: NOW - 60_000 }),
    sess("liveLongTurn", "chatgpt", { locked: true, clientGone: false, lockedAt: NOW - 900_000 }),
  ];
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: LIMITS });
  assert.deepEqual(plan.closeSessions.map((c) => c.id), ["abandoned"]);
});

test("orphan provider tabs and surplus blank tabs are closed; foreign tabs never are", () => {
  const pages = [
    { key: "owned", url: "https://chatgpt.com/" },
    { key: "orphan", url: "https://chatgpt.com/c/zzz" },
    { key: "asc", url: "https://appstoreconnect.apple.com/apps/1/distribution/privacy" },
    { key: "blank1", url: "about:blank" },
    { key: "blank2", url: "chrome://newtab/" },
  ];
  const orphanSince = new Map([["orphan", NOW - 200_000], ["asc", NOW - 999_999]]);
  const plan = planCleanup({ sessions: [], pages, ownedPageKeys: new Set(["owned"]), now: NOW, limits: LIMITS, orphanSince });
  const keys = plan.closePages.map((c) => c.key).sort();
  assert.deepEqual(keys, ["blank2", "orphan"]);
});

test("a provider tab is not closed the first time it looks orphaned — a session being created opens its page before registering", () => {
  const pages = [{ key: "creating", url: "https://gemini.google.com/app" }];
  const justSeen = planCleanup({ sessions: [], pages, ownedPageKeys: new Set(), now: NOW, limits: LIMITS, orphanSince: new Map([["creating", NOW - 5_000]]) });
  assert.equal(justSeen.closePages.length, 0);
  const neverSeen = planCleanup({ sessions: [], pages, ownedPageKeys: new Set(), now: NOW, limits: LIMITS });
  assert.equal(neverSeen.closePages.length, 0, "no first-seen record means not yet eligible");
});

test("constructing a SessionManager outside test mode does NOT start the tab janitor", async () => {
  // The regression: the janitor used to start in the constructor, so a stray
  // import against the live Chrome swept the running bridge's tabs.
  const { isTabJanitorRunning } = await import("../src/session/TabJanitor.js");
  const { SessionManager } = await import("../src/session/Manager.js");
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let m;
  try {
    m = new SessionManager();
    assert.equal(isTabJanitorRunning(), false);
  } finally {
    process.env.NODE_ENV = prev;
    if (m?.gcInterval) clearInterval(m.gcInterval);
  }
});

test("an unused standby tab expires only when its provider has no sessions", () => {
  const poolEntries = [
    { providerId: "kimi", id: "k", pooledAt: NOW - 900_000 },
    { providerId: "gemini", id: "g", pooledAt: NOW - 900_000 },
    { providerId: "deepseek", id: "d", pooledAt: NOW - 60_000 },
  ];
  const plan = planCleanup({ sessions: [sess("s", "gemini", { lastUsedAt: NOW - 1_000 })], pages: [], ownedPageKeys: new Set(), now: NOW, limits: LIMITS, poolEntries });
  assert.deepEqual(plan.closePool.map((c) => c.id), ["k"]);
});

test("census counts sessions, locks, abandoned turns and orphans per provider", () => {
  const sessions = [sess("a", "chatgpt"), sess("b", "chatgpt", { locked: true, clientGone: true, lockedAt: NOW })];
  const pages = [{ key: "x", url: "https://gemini.google.com/app" }, { key: "y", url: "https://example.com" }];
  const c = census({ sessions, pages, ownedPageKeys: new Set(), poolCounts: { chatgpt: 1 } });
  assert.equal(c.providers.chatgpt.sessions, 2);
  assert.equal(c.providers.chatgpt.abandoned, 1);
  assert.equal(c.providers.chatgpt.pool, 1);
  assert.equal(c.providers.gemini.orphanTabs, 1);
  assert.equal(c.otherTabs, 1);
});

/**
 * 2026-09-23: qwen held SEVEN sessions against a cap of three, with nine tabs
 * open on chat.qwen.ai — every session idle for minutes (77s, 105s, 145s, 192s,
 * 223s, 279s) and every one still flagged `locked`.
 *
 * No existing rule could reclaim them. Rule 1 needs `clientGone`, which only
 * ask.js sets when the HTTP caller disconnects; these callers had returned
 * normally. Rule 2 skips anything locked. The locks were stranded by a cleanup
 * that hung on a wedged page (see withSessionLock), so nothing would ever
 * release them and the cap was unenforceable.
 *
 * The first attempt at the fix ALSO required the session to be idle past
 * abandonedTurnMs, assuming a live turn keeps lastUsedAt fresh. It does not —
 * Manager.getSession() bumps it on acquisition, then the turn runs untouched —
 * so that rule would have closed live turns mid-answer. The existing
 * "a live locked turn is not [closed]" test caught it. Duration alone is the
 * safe discriminator, at a threshold no real turn can reach.
 */

const STALE = { ...LIMITS, staleLockMs: 45 * 60 * 1000 };

test("a lock held longer than any turn can run is reclaimed, even with clientGone false", () => {
  const sessions = [
    sess("stale", "qwen", { locked: true, clientGone: false, lockedAt: NOW - 50 * 60_000 }),
  ];
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: STALE });
  const hit = plan.closeSessions.find((c) => c.id === "stale");
  assert.ok(hit, "a lock nothing will release must be reclaimable");
  assert.match(hit.reason, /stale lock/);
});

test("a LONG BUT REAL turn is never reclaimed — this is the case the first attempt broke", () => {
  // Ten minutes into a generation: lastUsedAt is stale because it is only
  // bumped on acquisition, so duration is all that separates this from a
  // dead lock. It must survive.
  const sessions = [
    sess("liveTenMin", "qwen", {
      locked: true,
      clientGone: false,
      lockedAt: NOW - 10 * 60_000,
      lastUsedAt: NOW - 10 * 60_000,
    }),
  ];
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: STALE });
  assert.deepEqual(plan.closeSessions.map((c) => c.id), [], "a live long turn must survive");
});

test("even a turn at the client's maximum ask timeout (30m) survives", () => {
  const sessions = [
    sess("atMaxTimeout", "qwen", { locked: true, clientGone: false, lockedAt: NOW - 30 * 60_000 }),
  ];
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: STALE });
  assert.deepEqual(plan.closeSessions.map((c) => c.id), []);
});

test("the real qwen leak: sessions locked for an hour are all reclaimed", () => {
  const sessions = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((id, i) =>
    sess(id, "qwen", { locked: true, clientGone: false, lockedAt: NOW - (60 + i) * 60_000 }),
  );
  const plan = planCleanup({ sessions, pages: [], ownedPageKeys: new Set(), now: NOW, limits: STALE });
  assert.equal(plan.closeSessions.length, 7, "every unreclaimable session should now be reclaimed");
});
