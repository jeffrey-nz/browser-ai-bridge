import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cooldownManager,
  WRITABLE_PROVIDERS,
} from "../src/session/CooldownManager.js";
import { buildProvidersPayload } from "../src/routes/health.js";
import { askOne } from "../src/routes/ask/askOne.js";
import { skipTier } from "../src/routes/ask/tiers.js";

// T-097: cooldownManager has exactly ONE writer (gemini's errorHandler.js)
// and five readers keyed by an arbitrary providerId. For the other nine
// PROVIDER_CONFIG keys, check() used to return {active:false} — not a
// reading, but what the absence of a writer looks like. These tests drive
// the REAL trigger() and the REAL consumer functions (buildProvidersPayload,
// askOne, skipTier) directly, per clause 4 — no live bridge, no browser: all
// three read cooldownManager.check() before touching any session/browser
// state, which is exactly what makes this driveable without one.
test.describe("T-097: cooldown is tri-state, and a real trigger() reaches every reader", () => {
  test("check() reads null — not false — for a provider with no writer", () => {
    assert.equal(WRITABLE_PROVIDERS.has("copilot"), false);
    const cd = cooldownManager.check("copilot");
    assert.equal(cd.active, null);
    assert.equal(cd.remainingSeconds, null);
  });

  test("check() reads false (measured, clear) for gemini when nothing has triggered it", () => {
    assert.equal(WRITABLE_PROVIDERS.has("gemini"), true);
    const cd = cooldownManager.check("gemini");
    assert.equal(cd.active, false);
    assert.equal(cd.remainingSeconds, 0);
  });

  test("a real cooldownManager.trigger('gemini', ...) is seen, true, by /api/ping's payload, askOne's refusal, and skipTier — together, from one trigger", async () => {
    cooldownManager.trigger("gemini", 120);
    try {
      // 1. /api/ping — buildProvidersPayload (health.js)
      const payload = buildProvidersPayload([]);
      assert.equal(payload.gemini.cooldown, true);
      assert.ok(
        payload.gemini.cooldownSeconds > 0,
        `expected a positive cooldownSeconds, got ${payload.gemini.cooldownSeconds}`,
      );
      // A provider with no writer is untouched by gemini's own trigger —
      // still reads null, not false and not gemini's cooldown value.
      assert.equal(payload.copilot.cooldown, null);
      assert.equal(payload.copilot.cooldownSeconds, null);

      // 2. askOne's refusal (askOne.js) — the cooldown check is the first
      // thing askOne does, before any session/browser is touched, so this
      // runs and returns synchronously with no live bridge.
      const result = await askOne("gemini", "hello", "req-t097-cooldown");
      assert.equal(result.answered, false);
      assert.equal(result.reason, "cooldown");
      assert.ok(
        result.retryAfter > 0,
        `expected a positive retryAfter, got ${result.retryAfter}`,
      );

      // 3. skipTier (ask/tiers.js) — the only thing that can ever skip a
      // tier without asking it, and only for gemini.
      const skip = skipTier("gemini");
      assert.equal(skip.skip, true);
      assert.ok(
        skip.remainingSeconds > 0,
        `expected a positive remainingSeconds, got ${skip.remainingSeconds}`,
      );
      // skipTier for a provider with no writer can never skip — there is
      // nothing for it to have read as active.
      assert.deepEqual(skipTier("copilot"), { skip: false });
    } finally {
      // cooldownManager is a module-level singleton — clean up so this
      // test's trigger() does not leak into any other test file's run.
      cooldownManager.cooldowns.delete("gemini");
    }
  });

  test("cleanup left gemini clear again (no leaked cooldown state)", () => {
    const cd = cooldownManager.check("gemini");
    assert.equal(cd.active, false);
    assert.equal(cd.remainingSeconds, 0);
  });
});

// T-102: API.md published `reason: "cooldown"` (askOne.js) and "a tier is
// skipped without being asked when it is already cooling down" (ask.js's
// tier chain) as general behaviour, with no qualification — but both read
// cooldownManager.check().active with a plain truthiness test
// (`if (cd.active)`), and T-097 made that null, not false, for the nine
// providers with no writer. null is falsy, so both are structurally
// unreachable for those nine, not merely unobserved. Demonstrated here
// under a DELIBERATE forced trigger() — not the default never-triggered
// state — so this proves the gate itself is closed, not just that nobody
// has opened it yet. askOne() itself is not called for the non-writable
// case (unlike the writable case above): past its own cooldown check it
// touches resolveSession/sessionManager, which needs a live
// session/browser this unit test does not have — the exact boolean gate
// askOne.js:97 reads is asserted directly instead, which is the same
// question without the live dependency.
test.describe("T-102: 'cooldown' as a reason/tier-skip stays unreachable for a non-writable provider, even under a forced trigger()", () => {
  test("chatgpt reads active:null even after cooldownManager.trigger('chatgpt', ...) is called directly for it", () => {
    assert.equal(WRITABLE_PROVIDERS.has("chatgpt"), false);
    cooldownManager.trigger("chatgpt", 999);
    try {
      const cd = cooldownManager.check("chatgpt");
      assert.equal(cd.active, null);
      // askOne.js:97's exact gate is `if (cd.active)` — null is falsy, so
      // this branch (reason: "cooldown") can never fire for chatgpt.
      assert.equal(Boolean(cd.active), false);
    } finally {
      cooldownManager.cooldowns.delete("chatgpt");
    }
  });

  test("skipTier('chatgpt') never skips, even after the same forced trigger()", () => {
    cooldownManager.trigger("chatgpt", 999);
    try {
      assert.deepEqual(skipTier("chatgpt"), { skip: false });
    } finally {
      cooldownManager.cooldowns.delete("chatgpt");
    }
  });

  test("gemini, for contrast, DOES reach both gates under the same trigger()", () => {
    cooldownManager.trigger("gemini", 120);
    try {
      assert.equal(cooldownManager.check("gemini").active, true);
      assert.equal(skipTier("gemini").skip, true);
    } finally {
      cooldownManager.cooldowns.delete("gemini");
    }
  });
});
