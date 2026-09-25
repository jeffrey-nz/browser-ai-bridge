import { test } from "node:test";
import assert from "node:assert/strict";

import { SessionPool } from "../src/session/Pool.js";

/**
 * A STANDBY TAB CAN DIE WHILE IT WAITS, AND THE POOL HANDED IT OUT ANYWAY.
 *
 * A pooled session sits unlocked with nobody watching it, sometimes for
 * minutes. In that window its tab can be closed by the GC sweep, by
 * TabJanitor's cap, by a Chrome crash, or by a person tidying up a window.
 * acquire() never asked: it shifted the dead session out and returned it, the
 * caller adopted its page, and the first action failed with "Target page,
 * context or browser has been closed" — logged in the same second as the
 * cheerful "Fast-booting from warm pool" line right above it.
 *
 * Measured on reader-scripts ca-en/learn-catalan, 2026-09-25: 78 such failures
 * over 23 chapters, arriving in bursts — 44 of 51 ChatGPT submissions failed in
 * the 15:00 hour — with gemini warm-ups failing the same way alongside them.
 * The client could not distinguish this from a broken provider, so it spent
 * full browser turns on a lane that was dead before it was handed over.
 *
 * Which closer is responsible turned out to be the wrong question. A page can
 * always be closed between pooling and acquisition, so the pool must simply
 * never hand out one that is already gone: discard it and let the caller cold
 * boot, exactly as it would have done had the pool been empty.
 */

const fakeSession = (id, { closed = false } = {}) => {
  const s = {
    id,
    page: { isClosed: () => closed },
    engine: { closed: false, close: async () => { s.engine.closed = true; } },
  };
  return s;
};

// Keep replenish() from reaching for a real browser during acquire().
const inert = (pool) => {
  pool.replenish = async () => {};
  return pool;
};

test("a live standby is handed out, as before", () => {
  const pool = inert(new SessionPool());
  const live = fakeSession("live");
  pool.warmSessions.set("chatgpt", [live]);

  assert.equal(pool.acquire("chatgpt"), live);
});

test("a standby whose tab was closed while pooled is NOT handed out", () => {
  const pool = inert(new SessionPool());
  pool.warmSessions.set("chatgpt", [fakeSession("dead", { closed: true })]);

  assert.equal(
    pool.acquire("chatgpt"),
    null,
    "a dead standby must cold boot, not fail in the caller's first action",
  );
});

test("the dead standby's engine is closed, so its session is not leaked", () => {
  const pool = inert(new SessionPool());
  const dead = fakeSession("dead", { closed: true });
  pool.warmSessions.set("chatgpt", [dead]);

  pool.acquire("chatgpt");
  assert.equal(dead.engine.closed, true);
});

test("a dead standby is skipped in favour of a live one behind it", () => {
  // POOL_SIZE is 1 today, but the pool is a list and recycling can push more
  // than one back; skipping must not throw away a usable tab.
  const pool = inert(new SessionPool());
  const live = fakeSession("live");
  pool.warmSessions.set("chatgpt", [fakeSession("dead", { closed: true }), live]);

  assert.equal(pool.acquire("chatgpt"), live);
});

test("every standby dead means a cold boot, and the pool is left empty", () => {
  const pool = inert(new SessionPool());
  pool.warmSessions.set("chatgpt", [
    fakeSession("d1", { closed: true }),
    fakeSession("d2", { closed: true }),
  ]);

  assert.equal(pool.acquire("chatgpt"), null);
  assert.equal(pool.warmSessions.get("chatgpt").length, 0, "dead tabs must not stay pooled");
});

test("an empty pool still cold boots without touching replenish", () => {
  //[[ acquire() deliberately does NOT replenish on the empty path: the caller
  //   is about to cold boot, and warming concurrently opens a second tab for
  //   the same provider. The dead-standby path must not reintroduce that. ]]
  const pool = new SessionPool();
  let replenished = 0;
  pool.replenish = async () => { replenished++; };
  pool.warmSessions.set("chatgpt", [fakeSession("dead", { closed: true })]);

  assert.equal(pool.acquire("chatgpt"), null);
  assert.equal(replenished, 0, "discarding a dead standby must not warm a second tab");
});

test("a session with no page object is treated as usable, not discarded", () => {
  // Defensive: isClosed is optional chaining all the way down, and a provider
  // engine that exposes no page must not be silently thrown away.
  const pool = inert(new SessionPool());
  const odd = { id: "odd", engine: { close: async () => {} } };
  pool.warmSessions.set("chatgpt", [odd]);

  assert.equal(pool.acquire("chatgpt"), odd);
});
