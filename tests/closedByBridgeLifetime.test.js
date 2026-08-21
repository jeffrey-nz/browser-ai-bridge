import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/session/Manager.js";
import { sessionPool } from "../src/session/Pool.js";
import {
  recordFreshSessionCreated,
  getLastUnexpectedPageCloseAt,
} from "../src/session/collapseDetector.js";

/**
 * T-028: closedByBridge (T-023's rejection fix) is set on a session object
 * and never explicitly cleared at the mark sites (ask.js/askOne.js) — those
 * close the page fire-and-forget, not awaited, so _recycleOrClose's
 * `!session.page?.isClosed()` recycle check can race it. If that race is
 * lost, a marked-but-still-open session gets pushed back into the pool,
 * SessionManager.createSession()'s pool-hit branch acquires it, and the
 * `...session` spread into registry.add() would carry closedByBridge:true
 * forward into what is now a DIFFERENT, freshly-issued session — silently
 * disabling the collapse detector for it forever.
 *
 * Simulates the losing side of that race directly: a pool hit whose stub
 * session already carries closedByBridge:true (as if it rode along through
 * the recycle race), and checks createSession() strips it before the
 * session re-enters circulation — proven by a genuine page death on THAT
 * SAME session id being recorded afterward, which would silently NOT
 * happen if the flag survived.
 */

function racedPoolHitSession(id) {
  return {
    id,
    providerId: "fake-provider",
    page: { isClosed: () => false },
    createdAt: new Date(),
    closedByBridge: true, // simulates riding along through the recycle race
  };
}

test("a session carrying closedByBridge from a raced pool hit does not carry it into the registry", async () => {
  recordFreshSessionCreated();

  const originalAcquire = sessionPool.acquire.bind(sessionPool);
  sessionPool.acquire = () => racedPoolHitSession("raced-session");
  let mgr;
  try {
    mgr = new SessionManager();
    const sessionId = await mgr.createSession("fake-provider");
    assert.equal(sessionId, "raced-session");
  } finally {
    sessionPool.acquire = originalAcquire;
  }

  const registered = mgr.registry.get("raced-session");
  assert.equal(
    registered.closedByBridge,
    false,
    "closedByBridge must not survive into the registry entry for a session about to be reused",
  );

  // Now simulate a GENUINE external collapse of this SAME (reused)
  // session's page, and confirm it IS recorded — this is the actual
  // observable consequence of the flag riding along: if it had survived,
  // this would silently stay null.
  registered.page.isClosed = () => true;
  await mgr._cleanupStaleSessions();

  assert.notEqual(
    getLastUnexpectedPageCloseAt(),
    null,
    "a genuine collapse on a reused session must be caught, not permanently silenced by a stale mark",
  );
  recordFreshSessionCreated(); // leave module state clean for other tests
});
