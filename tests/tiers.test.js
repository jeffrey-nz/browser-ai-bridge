import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTiers,
  defaultTiers,
  anyRateLimited,
} from "../src/routes/ask/tiers.js";

/**
 * The chain is a PREFERENCE, not a pool. These pin the three properties a
 * caller depends on: order is kept, a session pins its provider, and nothing
 * unknown or duplicated can get into the chain.
 */

test("a named chain is kept in order", () => {
  assert.deepEqual(resolveTiers({ providers: ["gemini", "chatgpt", "grok"] }), [
    "gemini",
    "chatgpt",
    "grok",
  ]);
});

test("the requested provider leads a chain given as `fallback`", () => {
  assert.deepEqual(
    resolveTiers({ provider: "gemini", fallback: ["chatgpt"] }),
    ["gemini", "chatgpt"],
  );
});

test("a sessionId request gets NO chain", () => {
  // Answering a continuing conversation from a different tab would be a
  // different conversation wearing the same id. critique.py depends on this:
  // its whole pass is one session, and a frame judged by another model would
  // be scored against anchors that model never saw.
  assert.deepEqual(
    resolveTiers({ sessionId: "abc", providers: ["gemini", "chatgpt"] }),
    [],
  );
});

test("unknown providers are dropped rather than attempted", () => {
  assert.deepEqual(
    resolveTiers({ providers: ["gemini", "not-a-provider", "chatgpt"] }),
    ["gemini", "chatgpt"],
  );
});

test("a provider named twice is asked once", () => {
  // Otherwise a chain of ["gemini","gemini"] would spend two attempts and two
  // cooldown checks discovering the same thing.
  assert.deepEqual(
    resolveTiers({
      provider: "gemini",
      providers: ["gemini", "gemini", "chatgpt"],
    }),
    ["gemini", "chatgpt"],
  );
});

test("with no chain named, the request is a single tier", () => {
  const saved = process.env.PROVIDER_TIERS;
  delete process.env.PROVIDER_TIERS;
  assert.deepEqual(resolveTiers({ provider: "gemini" }), ["gemini"]);
  if (saved !== undefined) process.env.PROVIDER_TIERS = saved;
});

test("PROVIDER_TIERS supplies the fallbacks when the request names none", () => {
  const saved = process.env.PROVIDER_TIERS;
  process.env.PROVIDER_TIERS = "chatgpt, grok";
  assert.deepEqual(resolveTiers({ provider: "gemini" }), [
    "gemini",
    "chatgpt",
    "grok",
  ]);
  assert.deepEqual(defaultTiers(), ["chatgpt", "grok"]);
  if (saved === undefined) delete process.env.PROVIDER_TIERS;
  else process.env.PROVIDER_TIERS = saved;
});

test("a garbage PROVIDER_TIERS cannot poison the chain", () => {
  const saved = process.env.PROVIDER_TIERS;
  process.env.PROVIDER_TIERS = ",,  , nonsense ,";
  assert.deepEqual(resolveTiers({ provider: "gemini" }), ["gemini"]);
  if (saved === undefined) delete process.env.PROVIDER_TIERS;
  else process.env.PROVIDER_TIERS = saved;
});

/**
 * The chain must not cost a request its provider.
 *
 * Regression: the route skipped the cooldown gate for a chained request by
 * passing `null` as the provider, which tripped validateRequest's "you must
 * name a provider or a session" guard instead. With PROVIDER_TIERS set in the
 * environment EVERY request is chained, so the bridge answered every ask with
 * "Missing provider or sessionId" — a total outage, from a change whose unit
 * tests were all green. They tested the chain resolver and nothing tested the
 * thing that consumes it.
 */
test("a chained request still has to name a provider", async () => {
  const { validateRequest } = await import("../src/routes/ask/validation.js");
  const req = { body: { prompt: "hello" } };

  const named = validateRequest(req, null, "gemini", { skipCooldown: true });
  assert.equal(named.valid, true, "naming a provider is enough, chain or not");

  const anonymous = validateRequest(req, null, undefined, {
    skipCooldown: true,
  });
  assert.equal(anonymous.valid, false);
  assert.match(anonymous.error, /Missing provider or sessionId/);
});

test("skipCooldown only relaxes the cooldown, not the rest of validation", async () => {
  const { validateRequest } = await import("../src/routes/ask/validation.js");

  const noPrompt = validateRequest({ body: {} }, null, "gemini", {
    skipCooldown: true,
  });
  assert.equal(noPrompt.valid, false);
  assert.match(noPrompt.error, /Missing prompt/);

  const unknown = validateRequest({ body: { prompt: "x" } }, null, "nope", {
    skipCooldown: true,
  });
  assert.equal(unknown.valid, false);
  assert.match(unknown.error, /Unknown provider/);
});

test("a request that names its chain as `providers` has named a provider", async () => {
  // Second regression of the same shape: `{"providers":[...]}` carries no
  // `provider` key, so validating the raw field called a perfectly well-formed
  // request anonymous. The route validates the chain's head now.
  const { validateRequest } = await import("../src/routes/ask/validation.js");
  const chain = resolveTiers({ providers: ["gemini", "chatgpt"] });
  assert.deepEqual(chain, ["gemini", "chatgpt"]);

  const v = validateRequest({ body: { prompt: "hi" } }, null, chain[0], {
    skipCooldown: true,
  });
  assert.equal(v.valid, true);
});

test("a tier on cooldown is skipped, and says for how long", async () => {
  const { skipTier } = await import("../src/routes/ask/tiers.js");
  const cooling = (p) =>
    p === "gemini" ? { active: true, remainingSeconds: 47 } : { active: false };

  assert.deepEqual(skipTier("gemini", cooling), {
    skip: true,
    remainingSeconds: 47,
  });
  assert.deepEqual(skipTier("chatgpt", cooling), { skip: false });
});

/**
 * T-113: the chain-exhausted 503 used to hardcode `rateLimited: true`
 * unconditionally, reachable with every tier skipped purely for cooldown —
 * zero rate-limit events that turn, `attempted` reading all `"cooldown"`,
 * the body still claiming one happened. anyRateLimited() is the fix's own
 * pure core: does `attempted` itself record a rate limit, going by the one
 * outcome string ask.js's own loop writes for it (`"rate limit"`, a space —
 * not `"rate_limited"`, not `"cooldown"`, not a raw error string).
 */
test("anyRateLimited is false when every tier was skipped for cooldown, never rate-limited", () => {
  assert.equal(
    anyRateLimited([
      { provider: "gemini", outcome: "cooldown" },
      { provider: "chatgpt", outcome: "cooldown" },
    ]),
    false,
  );
});

test("anyRateLimited is true when at least one tier's outcome is the rate-limit spelling", () => {
  assert.equal(
    anyRateLimited([
      { provider: "gemini", outcome: "cooldown" },
      { provider: "chatgpt", outcome: "rate limit" },
    ]),
    true,
  );
});

test("anyRateLimited does not mistake a raw resolveSession error string for a rate limit", () => {
  // A session-resolution failure pushes the raw error message as `outcome`
  // (ask.js:96) — free text, not the fixed "rate limit" spelling, even if
  // it happens to contain related words.
  assert.equal(
    anyRateLimited([
      {
        provider: "gemini",
        outcome: "Session creation failed: rate limited by upstream",
      },
    ]),
    false,
  );
});

test("anyRateLimited is false on an empty attempted array", () => {
  assert.equal(anyRateLimited([]), false);
});
