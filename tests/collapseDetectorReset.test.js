import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/session/Manager.js";
import { sessionPool } from "../src/session/Pool.js";
import {
  recordUnexpectedPageClose,
  recordFreshSessionCreated,
  getLastUnexpectedPageCloseAt,
} from "../src/session/collapseDetector.js";

/**
 * T-023 (rejection round, second point): a POOL HIT never reaches
 * Creator.js's createNewSession() — sessionPool.acquire() returns an
 * already-initialized session straight from SessionManager.createSession(),
 * skipping the cold-boot path entirely. The original fix only reset the
 * sticky collapse flag from inside Creator.js, so a bridge already back to
 * serving working sessions out of the warm pool would keep reporting
 * "collapsed" until its NEXT cold boot — which a live collapse can push
 * arbitrarily far out via Pool.js's REPLENISH_COOLDOWN_MS.
 *
 * Stubs `sessionPool.acquire` to force a pool hit (no real browser, no
 * Creator.js involvement) and checks the flag clears anyway — the fix this
 * ticket added inside SessionManager.createSession() itself, after
 * startNewChat() succeeds, not only in Creator.js.
 */

function poolHitStubSession(id) {
  return {
    id,
    providerId: "fake-provider",
    // No .engine — createSession()'s startNewChat/setMode calls are all
    // guarded by `typeof session.engine?.startNewChat === "function"`, so a
    // missing engine just skips them rather than needing a full stub.
    page: { isClosed: () => false },
    createdAt: new Date(),
  };
}

test("a pool hit through SessionManager.createSession() resets the collapse flag, not only a cold boot", async () => {
  recordUnexpectedPageClose();
  assert.notEqual(
    getLastUnexpectedPageCloseAt(),
    null,
    "sanity: a collapse is recorded before the pool hit",
  );

  const originalAcquire = sessionPool.acquire.bind(sessionPool);
  sessionPool.acquire = (providerId) => poolHitStubSession("pool-hit-test");
  try {
    const mgr = new SessionManager();
    const sessionId = await mgr.createSession("fake-provider");
    assert.equal(sessionId, "pool-hit-test");
  } finally {
    sessionPool.acquire = originalAcquire;
  }

  assert.equal(
    getLastUnexpectedPageCloseAt(),
    null,
    "a session successfully handed out from the pool is proof the browser " +
      "can still drive a live page, cold-booted or not",
  );
});

test("a FAILED pool hit (startNewChat throws) does not reset the flag — only a confirmed-working session counts", async () => {
  recordUnexpectedPageClose();

  const originalAcquire = sessionPool.acquire.bind(sessionPool);
  sessionPool.acquire = () => ({
    id: "pool-hit-fail-test",
    providerId: "fake-provider",
    page: { isClosed: () => false },
    createdAt: new Date(),
    engine: {
      startNewChat: async () => {
        throw new Error(
          "page.goto: Target page, context or browser has been closed",
        );
      },
      close: async () => {},
    },
  });
  try {
    const mgr = new SessionManager();
    await assert.rejects(() => mgr.createSession("fake-provider"));
  } finally {
    sessionPool.acquire = originalAcquire;
  }

  assert.notEqual(
    getLastUnexpectedPageCloseAt(),
    null,
    "a failed setup is not evidence of recovery — must not clear the flag",
  );
  recordFreshSessionCreated(); // leave module state clean for other tests
});
