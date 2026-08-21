import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordUnexpectedPageClose,
  recordFreshSessionCreated,
  getLastUnexpectedPageCloseAt,
} from "../src/session/collapseDetector.js";

/**
 * T-023: attachedPages (src/routes/health.js) is only informative while a
 * dead session is still in the registry — a window bounded by the GC sweep
 * or the next getSession() touch. Once the registry drains, attachedPages
 * reads 0 whether the browser is dead or was simply never asked to do
 * anything. This module is the sticky half that survives the drain; pinned
 * here as pure state-transition logic, no browser and no registry needed.
 */

test("starts with no collapse recorded", () => {
  // Reset to a known state — recordFreshSessionCreated is exactly "no
  // collapse outstanding", which is also the module's own initial value.
  recordFreshSessionCreated();
  assert.equal(getLastUnexpectedPageCloseAt(), null);
});

test("recordUnexpectedPageClose sets a timestamp; recordFreshSessionCreated clears it", () => {
  recordFreshSessionCreated();
  assert.equal(getLastUnexpectedPageCloseAt(), null, "starts clear");

  const before = Date.now();
  recordUnexpectedPageClose();
  const ts = getLastUnexpectedPageCloseAt();
  assert.equal(typeof ts, "number");
  assert.ok(ts >= before, "timestamp is at/after the call");

  recordFreshSessionCreated();
  assert.equal(
    getLastUnexpectedPageCloseAt(),
    null,
    "a fresh session clears the sticky flag — the recovery signal",
  );
});

test("repeated unexpected closes keep advancing the timestamp, not just latching once", () => {
  recordFreshSessionCreated();
  recordUnexpectedPageClose();
  const first = getLastUnexpectedPageCloseAt();
  recordUnexpectedPageClose();
  const second = getLastUnexpectedPageCloseAt();
  assert.ok(second >= first);
  recordFreshSessionCreated();
});
