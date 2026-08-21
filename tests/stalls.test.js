import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markActive,
  markInactive,
  activeDurationMs,
  isLongRunning,
  registerStall,
  resolveStall,
  getSessionState,
} from "../src/stalls.js";

/**
 * T-003: the field that used to be `stalledSessions` can only ever be
 * non-zero with a human operator attached (registerStall is only reached
 * from the interactive TTY path in stallLoop.js) — an unattended bridge, the
 * kind /api/ping actually serves most of the time, can never be observed
 * driving it live. Pinned here instead: the same state transition
 * getSessionState/health.js's `awaitingOperatorSessions` count is exercised
 * directly, synchronously, with no browser and no operator.
 *
 * longRunningSessions (the field this ticket added) is the one meant to work
 * for an unattended caller — pinned by threshold rather than by a real sleep,
 * since it is pure elapsed time on `activeSessions`.
 */

test("activeDurationMs and isLongRunning track a session marked active", () => {
  const id = "stalls-test-active";
  assert.equal(activeDurationMs(id), null, "not active yet");

  markActive(id);
  const d = activeDurationMs(id);
  assert.equal(typeof d, "number");
  assert.ok(d >= 0);

  // Varying the threshold rather than sleeping: elapsed time (>= 0ms, and
  // possibly exactly 0 within the same millisecond) always exceeds a
  // negative bar; nothing exceeds an effectively-infinite one.
  assert.equal(isLongRunning(id, -1), true);
  assert.equal(isLongRunning(id, 10 * 60 * 1000), false);

  markInactive(id);
  assert.equal(activeDurationMs(id), null, "cleared once inactive");
  assert.equal(isLongRunning(id, -1), false);
});

test("registerStall/resolveStall move a session into and out of the awaitingOperator state — the exact transition awaitingOperatorSessions counts", async () => {
  const id = "stalls-test-operator";
  assert.equal(getSessionState(id), "idle");

  // registerStall's Promise executor sets stallMap synchronously before any
  // await, so the state change is observable without waiting on the promise
  // it returns — the same instant a real ping poll would see it.
  const stallPromise = registerStall(id);
  assert.equal(
    getSessionState(id),
    "stalled",
    "the state health.js's awaitingOperatorSessions counts",
  );

  const resolved = resolveStall(id, { action: "retry" });
  assert.equal(resolved, true);
  const result = await stallPromise;
  assert.equal(result.action, "retry");
  assert.equal(getSessionState(id), "idle", "cleared once resolved");
});
