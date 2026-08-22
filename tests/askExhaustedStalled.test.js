import { test } from "node:test";
import assert from "node:assert/strict";
import askRouter from "../src/routes/ask.js";
import { cooldownManager } from "../src/session/CooldownManager.js";

/**
 * T-113 redo: the prior fix (anyRateLimited(attempted) instead of a
 * hardcoded `true` on the chain-exhausted 503) was pinned only against the
 * pure helper — nothing in the suite drove src/routes/ask.js itself, so
 * reverting ask.js's own call site back to a literal `true` left the suite
 * green. This test drives the ACTUAL router with a real request, not a
 * description of one.
 *
 * The chain-exhausted 503 is reachable exactly one way: every tier in the
 * chain is skipped for cooldown, ending with the last one. `skipTier()`
 * calls `cooldownManager.check(id)` directly with no gate of its own — the
 * gate lives inside `cooldownManager.check()`, keyed on WRITABLE_PROVIDERS.
 * Patching `cooldownManager.check` itself (a method on a real, shared
 * singleton object both this test and ask.js's own import reference — not
 * an ES module import rebound, which Node refuses: `import * as ns` gives a
 * read-only namespace, confirmed empirically) makes EVERY provider report
 * "on cooldown" for the duration of one request, so every tier answers
 * skipTier().skip and the loop never reaches resolveSession — no session is
 * ever created and no browser is touched, the same guarantee the ticket's
 * own goal asked for.
 *
 * The OTHER direction (one tier's outcome is the "rate limit" spelling) is
 * not driven through the real router here: that requires an actual
 * provider turn to throw `err.rateLimited` inside `withSessionLock`, which
 * needs a real session and touches real session-creation machinery
 * (`resolveSession` is imported as a named ES binding, and — confirmed
 * empirically — a module namespace's exports are read-only from the
 * importer's side, so it cannot be monkey-patched the way
 * `cooldownManager`'s method can). That direction stays covered by
 * anyRateLimited's own existing direct unit tests (tests/tiers.test.js) —
 * this test's job is specifically the direction the bug was about: proving
 * a real all-cooldown call does NOT read `rateLimited: true`.
 */

function makeReqRes(body) {
  const req = {
    method: "POST",
    url: "/",
    originalUrl: "/",
    baseUrl: "",
    path: "/",
    body,
    headers: {},
    on() {},
    off() {},
  };
  let statusCode = null;
  let jsonBody = null;
  const headers = {};
  let onSent = () => {};
  const res = {
    set(name, value) {
      headers[name] = value;
      return res;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(payload) {
      jsonBody = payload;
      onSent();
    },
    writableEnded: true,
  };
  return {
    req,
    res,
    headers,
    get status() {
      return statusCode;
    },
    get body() {
      return jsonBody;
    },
    // The route sends its response via res.json() and never calls next() on
    // that path (correct Express behaviour) — dispatch() below waits for
    // this instead of for next().
    onSent(fn) {
      onSent = fn;
    },
  };
}

function dispatch(call) {
  return new Promise((resolve, reject) => {
    call.onSent(resolve);
    call.router(call.req, call.res, (err) => {
      if (err) reject(err);
    });
  });
}

test("a real request through the ACTUAL ask.js router, chain entirely on cooldown, gets rateLimited: false — not the old hardcoded true", async () => {
  const originalCheck = cooldownManager.check;
  cooldownManager.check = () => ({ active: true, remainingSeconds: 7 });
  try {
    const call = makeReqRes({
      providers: ["gemini", "chatgpt"],
      prompt: "hello",
    });
    call.router = askRouter;

    await dispatch(call);

    assert.equal(call.status, 503);
    assert.equal(call.body.success, false);
    assert.equal(call.body.error, "STALLED");
    assert.equal(call.body.stalled, true);
    assert.equal(
      call.body.rateLimited,
      false,
      "no tier ever rate-limited this turn — every entry is cooldown",
    );
    assert.deepEqual(call.body.attempted, [
      { provider: "gemini", outcome: "cooldown" },
      { provider: "chatgpt", outcome: "cooldown" },
    ]);
    assert.equal(call.headers["Retry-After"], "7");
  } finally {
    cooldownManager.check = originalCheck;
  }
});
