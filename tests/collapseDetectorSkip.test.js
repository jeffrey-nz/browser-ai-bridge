import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/session/Manager.js";
import {
  recordFreshSessionCreated,
  getLastUnexpectedPageCloseAt,
} from "../src/session/collapseDetector.js";

/**
 * T-023 (rejection round): ask.js and askOne.js deliberately close a
 * registered, non-auto-created session's own page on "Failed to submit
 * prompt" (a stuck tab, not a browser collapse) — but that session stays in
 * the registry, so the NEXT thing to touch it (GC sweep or a getSession()
 * call) used to discover the closed page and record it as an unexpected
 * collapse. Pinned here with a stub session and a fresh SessionManager
 * instance — no browser, no registry singleton shared with other tests.
 */

function stubSession(id, closedByBridge) {
  return {
    id,
    providerId: "fake-provider",
    page: { isClosed: () => true, __sessionId: undefined },
    createdAt: new Date(),
    lastUsedAt: Date.now(),
    locked: false,
    ...(closedByBridge ? { closedByBridge: true } : {}),
  };
}

test("_cleanupStaleSessions does not record a collapse for a session marked closedByBridge", async () => {
  recordFreshSessionCreated(); // known-clear starting state
  const mgr = new SessionManager();
  mgr.registry.add("s1", stubSession("s1", true));

  await mgr._cleanupStaleSessions();

  assert.equal(
    getLastUnexpectedPageCloseAt(),
    null,
    "a close this process asked for must not be recorded as a collapse",
  );
});

test("_cleanupStaleSessions DOES record a collapse for a closed page with no closedByBridge mark", async () => {
  recordFreshSessionCreated();
  const mgr = new SessionManager();
  mgr.registry.add("s2", stubSession("s2", false));

  await mgr._cleanupStaleSessions();

  assert.notEqual(
    getLastUnexpectedPageCloseAt(),
    null,
    "an unmarked closed page is still exactly what this detector exists to catch",
  );
  recordFreshSessionCreated(); // leave the module state clean for other tests
});

test("getSession does not record a collapse for a session marked closedByBridge", () => {
  recordFreshSessionCreated();
  const mgr = new SessionManager();
  mgr.registry.add("s3", stubSession("s3", true));

  const result = mgr.getSession("s3");

  assert.equal(result, null, "a dead-paged session is still not returned");
  assert.equal(
    getLastUnexpectedPageCloseAt(),
    null,
    "but its own close must not read as a collapse",
  );
});

test("getSession DOES record a collapse for an unmarked dead-paged session", () => {
  recordFreshSessionCreated();
  const mgr = new SessionManager();
  mgr.registry.add("s4", stubSession("s4", false));

  mgr.getSession("s4");

  assert.notEqual(getLastUnexpectedPageCloseAt(), null);
  recordFreshSessionCreated();
});
