import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAskTurn } from "../src/routes/ask/executor/index.js";

/**
 * T-011 put turnIndex/sessionAgeMs on every answered response, computed once
 * per turn so all of runAskTurn's return points agree (executor/index.js).
 * T-016: pin that with a stub session — no live browser, no running bridge —
 * so a later return point added without the pair is caught here rather than
 * discovered by hand against a live bridge, the way this field's only prior
 * verification was done.
 */

function fakeSession(engine, overrides = {}) {
  return {
    id: "test-session-turnposition",
    providerId: "fake-provider",
    engine,
    createdAt: new Date(Date.now() - 1000),
    page: { isClosed: () => false, bringToFront: async () => {} },
    ...overrides,
  };
}

test("a normal turn returns a numeric turnIndex and sessionAgeMs", async () => {
  const engine = {
    sendPromptAndWait: async () => ({ ok: true, text: "an answer" }),
  };
  const result = await executeAskTurn(fakeSession(engine), "hello", "req-1");

  assert.equal(typeof result.turnIndex, "number");
  assert.equal(typeof result.sessionAgeMs, "number");
  assert.ok(result.turnIndex >= 1);
});

test("turnIndex increments across two turns on the same session object", async () => {
  const engine = {
    sendPromptAndWait: async () => ({ ok: true, text: "an answer" }),
  };
  const session = fakeSession(engine);

  const first = await executeAskTurn(session, "first", "req-2");
  const second = await executeAskTurn(session, "second", "req-3");

  assert.equal(
    second.turnIndex,
    first.turnIndex + 1,
    "a test that only checks the field exists would pass against a hardcoded " +
      "1 — the exact failure mode messageCount had (T-011)",
  );
});

test("the reviewer-empty short-circuit return still carries turnIndex and sessionAgeMs", async () => {
  // runAskTurn's `isReviewerTurn && !response.ok` early return
  // (executor/index.js) — reachable from a stub with no rotation/stall
  // machinery involved, since it fires before handleRotationIfNeeded is
  // even reached on the failing branch checked here.
  const engine = {
    sendPromptAndWait: async () => ({ ok: false, text: "" }),
  };
  const result = await executeAskTurn(
    fakeSession(engine),
    "prompt",
    "req-4",
    "reviewer",
  );

  assert.equal(result.response, "");
  assert.equal(typeof result.turnIndex, "number");
  assert.equal(typeof result.sessionAgeMs, "number");
});
