import { test } from "node:test";
import assert from "node:assert/strict";
import { makeInteraction } from "../src/ai/generic/interaction.js";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { runPromptWorkflow } from "../src/ai/shared/promptWorkflow.js";

/**
 * T-114: API.md credited all five generic providers (kimi, qwen, zai,
 * mistral, perplexity) with "their own detected throttle". Only kimi has
 * one — a real phrase in its spec (GENERIC_SPECS.kimi.rateLimit) checked by
 * interaction.js's own per-provider poll gate. The other four have
 * `rateLimit: null`, so that gate never fires for them; what covers them
 * instead is one of TWO independent, shared text matches inside
 * runPromptWorkflow (src/ai/shared/promptWorkflow.js) — one reached only
 * after a stall (route A), one reached on a normally-completed response
 * with no stall at all (route B). These tests pin both halves against the
 * real code, not a description of it.
 */

function fakePage(visibleText) {
  return {
    getByText(text, opts) {
      return {
        first() {
          return {
            async isVisible() {
              return text === visibleText;
            },
          };
        },
      };
    },
  };
}

test("checkRateLimitHit never even checks the page for a spec with rateLimit: null (qwen/zai/mistral/perplexity's real shape)", async () => {
  const spec = { name: "test", rateLimit: null, locators: {} };
  const { checkRateLimitHit } = makeInteraction(spec);
  // A page that would say "visible" to ANY getByText call — if the gate
  // reached the page at all despite rateLimit being null, this would wrongly
  // report a hit.
  const page = {
    getByText() {
      return { first: () => ({ isVisible: async () => true }) };
    },
  };
  assert.equal(await checkRateLimitHit(page), false);
});

test("checkRateLimitHit fires for kimi's REAL spec string when that exact text is visible", async () => {
  const { checkRateLimitHit } = makeInteraction(GENERIC_SPECS.kimi);
  // `rateLimit` became a LIST on 2026-09-22 (see specs.js) — this test used to
  // hand the field itself to fakePage, which only works while it is a single
  // string. The phrase it was really pinning is the first entry, the sentence
  // kimi.ai showed in 2026-08; the list's other entries get their own test
  // below. Kept pointing at the spec rather than a copied literal so a change
  // to that sentence still shows up here.
  const [primaryPhrase] = GENERIC_SPECS.kimi.rateLimit;
  const page = fakePage(primaryPhrase);
  assert.equal(await checkRateLimitHit(page), true);
});

test("checkRateLimitHit is false for kimi's spec when its phrase is not on the page", async () => {
  const { checkRateLimitHit } = makeInteraction(GENERIC_SPECS.kimi);
  const page = fakePage("something unrelated");
  assert.equal(await checkRateLimitHit(page), false);
});

test("route B: runPromptWorkflow reports rateLimited:true for a NORMALLY-COMPLETED response whose text carries a rate-limit phrase — no stall involved", async () => {
  // waitForCompletion resolves true on the first call: the poll never
  // stalls, so route A (the stall-gated early-extraction check) is never
  // reached. Only route B (promptWorkflow.js's post-completion response-body
  // match) can produce this result.
  const result = await runPromptWorkflow(
    { waitForTimeout: async () => {} },
    "hello",
    "label",
    {
      providerName: "test",
      injectText: async () => {},
      clickSend: async () => {},
      waitForCompletion: async () => true,
      extractResponse: async () =>
        "Your messages are too frequent, please slow down.",
    },
  );
  assert.deepEqual(result, {
    ok: false,
    rateLimited: true,
    reason: "Rate limit detected in response body",
  });
});

test("route B does not fire on an ordinary, non-throttled answer", async () => {
  const result = await runPromptWorkflow(
    { waitForTimeout: async () => {} },
    "hello",
    "label",
    {
      providerName: "test",
      injectText: async () => {},
      clickSend: async () => {},
      waitForCompletion: async () => true,
      extractResponse: async () => "Here is your answer: 42.",
    },
  );
  assert.deepEqual(result, { ok: true, text: "Here is your answer: 42." });
});

test("the two routes' phrase lists diverge on whitespace — a match for route A's regex is not always a match for route B's", () => {
  // T-114 clause 2: route A tolerates arbitrary whitespace between words
  // (\s+); route B requires a literal single space. A notice wrapped across
  // a line break matches A and not B — documented in API.md rather than
  // fixed, since loosening a live detection regex without a captured
  // real-world miss is a behaviour change this ticket does not make.
  const wrappedNotice = "messages\nare\ntoo\nfrequent, please wait";
  const ROUTE_A_RE =
    /messages?\s+are\s+too\s+frequent|rate\s+limit|too\s+many\s+requests/i;
  const ROUTE_B_PATTERNS = [
    /messages? are too frequent/i,
    /rate limit/i,
    /too many requests/i,
  ];
  assert.equal(ROUTE_A_RE.test(wrappedNotice), true);
  assert.equal(
    ROUTE_B_PATTERNS.some((re) => re.test(wrappedNotice)),
    false,
  );
});

/**
 * 2026-09-22: two gaps behind a "stuck on the Kimi modal" report.
 *
 *  1. `rateLimit` held ONE sentence. Kimi's overload notice is not a fixed
 *     string, and any rewording silently disabled the per-provider gate — the
 *     turn then sat out the full 300s completion poll and fell into manual
 *     recovery instead of handing off. It now accepts a list.
 *  2. Nothing checked capacity on the SEND path. When the notice arrives as a
 *     modal it covers the composer, so the send never lands: four retries were
 *     burned and a generic "failed to trigger send" was thrown, leaving the
 *     provider un-flagged and the tab poisoned for the next turn.
 */

function pageSaying(...visible) {
  return {
    getByText(text) {
      return {
        first: () => ({
          isVisible: async () => visible.some((v) => v.includes(text)),
        }),
      };
    },
    getByRole() {
      return {
        first: () => ({ isVisible: async () => false, click: async () => {} }),
      };
    },
    locator() {
      return { last: () => ({}), first: () => ({}) };
    },
  };
}

test("a single-string rateLimit still works — the array is additive, not a replacement", async () => {
  const { checkRateLimitHit } = makeInteraction({
    name: "legacy",
    rateLimit: "Too many people are chatting with Kimi",
    locators: {},
  });
  assert.equal(
    await checkRateLimitHit(
      pageSaying("Too many people are chatting with Kimi"),
    ),
    true,
  );
  assert.equal(await checkRateLimitHit(pageSaying("all fine here")), false);
});

test("kimi's real spec now catches a REWORDED overload notice, not just the 2026-08 sentence", async () => {
  const { checkRateLimitHit } = makeInteraction(GENERIC_SPECS.kimi);
  // The original sentence must still hit.
  assert.equal(
    await checkRateLimitHit(
      pageSaying("Too many people are chatting with Kimi right now."),
    ),
    true,
  );
  // And so must the other halves of the same notice, which a rewording keeps.
  assert.equal(
    await checkRateLimitHit(
      pageSaying("Subscribe to enter a dedicated priority queue!"),
    ),
    true,
  );
  assert.equal(
    await checkRateLimitHit(pageSaying("Too many requests, slow down")),
    true,
  );
});

test("the capacity list refuses phrases a good answer could contain", async () => {
  const { checkRateLimitHit } = makeInteraction(GENERIC_SPECS.kimi);
  // This gate reads the WHOLE page, so anything a model might legitimately
  // write must not trip it — a hit throws away a turn that already succeeded.
  for (const innocent of [
    "The API has a rate limit of 60 requests per minute.",
    "If that fails, try again later.",
    "Demand for the course was high.",
  ]) {
    assert.equal(
      await checkRateLimitHit(pageSaying(innocent)),
      false,
      innocent,
    );
  }
});

test("a send that fails behind a capacity modal is reported as rateLimited, not as a broken button", async () => {
  const spec = {
    ...GENERIC_SPECS.kimi,
    // Force clickOrFallbackToEnter to throw by giving it a page whose
    // locators cannot be clicked; the point is what clickSend does with it.
    locators: { ...GENERIC_SPECS.kimi.locators },
  };
  const { clickSend } = makeInteraction(spec);
  const page = pageSaying("Too many people are chatting with Kimi right now.");
  await assert.rejects(
    () => clickSend(page),
    (e) => e.rateLimited === true && /over capacity/i.test(e.message),
  );
});

test("a send that fails with NO capacity notice still surfaces the original error", async () => {
  const { clickSend } = makeInteraction(GENERIC_SPECS.kimi);
  const page = pageSaying("nothing wrong here");
  await assert.rejects(
    () => clickSend(page),
    (e) => e.rateLimited !== true,
  );
});
