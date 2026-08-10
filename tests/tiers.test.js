import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTiers, defaultTiers } from "../src/routes/ask/tiers.js";

/**
 * The chain is a PREFERENCE, not a pool. These pin the three properties a
 * caller depends on: order is kept, a session pins its provider, and nothing
 * unknown or duplicated can get into the chain.
 */

test("a named chain is kept in order", () => {
  assert.deepEqual(
    resolveTiers({ providers: ["gemini", "chatgpt", "grok"] }),
    ["gemini", "chatgpt", "grok"],
  );
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
    resolveTiers({ provider: "gemini", providers: ["gemini", "gemini", "chatgpt"] }),
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
