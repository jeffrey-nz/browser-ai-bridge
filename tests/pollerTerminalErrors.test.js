import { test } from "node:test";
import assert from "node:assert/strict";
import { pollUntil } from "../src/shims/utils/poller.js";

/**
 * pollUntil ignores what its predicate throws, which is right for the case it
 * was written for — a Playwright call against a page mid-navigation throws and
 * the next tick succeeds. But `if (err.controlAbort) throw err` made that one
 * flag the only way out, and no provider sets it. They set `err.rateLimited`,
 * and they throw "Aborted (Web UI)". Both were caught, logged at trace level,
 * and dropped.
 *
 * MEASURED 2026-09-24: grok.com's poll detects its daily limit correctly every
 * 500ms and throws. The bridge log for those turns holds zero rate-limit lines
 * and four × "Grok polling timed out (Timeout after 600000ms)" — ten minutes a
 * turn, one new session a minute, seven alive at once against a cap of three.
 * The detection was never broken; its result could not leave the poller.
 *
 * Not a grok bug: `err.rateLimited` is thrown inside a predicate by grok,
 * chatgpt and src/ai/generic/interaction.js (kimi, qwen, zai, mistral,
 * perplexity), and "Aborted (Web UI)" by all of those plus gemini, copilot and
 * deepseek.
 */

const fast = { timeoutMs: 400, pollIntervalMs: 10, iterationTimeoutMs: 200 };

test("a rate limit escapes immediately instead of polling to the timeout", async () => {
  let calls = 0;
  const err = Object.assign(new Error("Grok rate limit reached"), {
    rateLimited: true,
  });
  await assert.rejects(
    () => pollUntil(async () => { calls++; throw err; }, fast),
    /rate limit reached/,
  );
  assert.equal(calls, 1, "it must stop on the first throw, not keep polling");
});

test('"Aborted (Web UI)" escapes — the literal all seven throw sites use', async () => {
  let calls = 0;
  await assert.rejects(
    () => pollUntil(async () => { calls++; throw new Error("Aborted (Web UI)"); }, fast),
    /Aborted/,
  );
  assert.equal(calls, 1);
});

test("controlAbort still escapes — the one flag that always worked", async () => {
  await assert.rejects(
    () => pollUntil(async () => {
      throw Object.assign(new Error("stopped"), { controlAbort: true });
    }, fast),
    /stopped/,
  );
});

test("an explicit terminal flag escapes, for a signal with no other marker", async () => {
  await assert.rejects(
    () => pollUntil(async () => {
      throw Object.assign(new Error("done for"), { terminal: true });
    }, fast),
    /done for/,
  );
});

test("an AbortError escapes by name", async () => {
  await assert.rejects(
    () => pollUntil(async () => {
      throw Object.assign(new Error("aborted by signal"), { name: "AbortError" });
    }, fast),
    /aborted by signal/,
  );
});

test("an ORDINARY fault is still swallowed and retried — the behaviour worth keeping", async () => {
  //[[ The half that must not regress. A poll that gave up the first time a
  //   Playwright call threw against a page mid-navigation would be useless,
  //   which is why the swallow exists at all. ]]
  let calls = 0;
  const result = await pollUntil(async () => {
    calls++;
    if (calls < 3) throw new Error("locator resolve failed: page navigating");
    return "answered";
  }, fast);
  assert.equal(result, "answered");
  assert.equal(calls, 3, "it must have kept going through the transient throws");
});

test("a predicate that just never becomes true still times out normally", async () => {
  await assert.rejects(
    () => pollUntil(async () => false, { ...fast, errorMessage: "Grok polling timed out" }),
    /Grok polling timed out/,
  );
});

test("a hung predicate is still capped per iteration rather than escaping", async () => {
  // iteration_timeout is an internal signal, not a terminal one — the loop must
  // keep its own deadline rather than surfacing it as a provider failure.
  await assert.rejects(
    () => pollUntil(() => new Promise(() => {}), { ...fast, errorMessage: "timed out" }),
    /timed out/,
  );
});
