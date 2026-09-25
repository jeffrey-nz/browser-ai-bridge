import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSuspensionSeconds,
  diagnoseBlockedPage,
  UNKNOWN_SUSPENSION_SECONDS,
} from "../src/ai/shared/blockedPage.js";
import {
  cooldownManager,
  WRITABLE_PROVIDERS,
} from "../src/session/CooldownManager.js";

/**
 * 2026-09-22, measured on chat.deepseek.com: the page had NO composer, NO
 * password field and NO sign-in control — just
 *
 *   "Due to violation of user policies, your account has been suspended
 *    until October 1, 2026 09:21."
 *
 * and a "Contact us" link. That is a timed suspension nine days out, and it is
 * neither a rate limit (which clears itself in minutes) nor a sign-in wall
 * (which a human fixes). The bridge saw only `locator.waitFor: Timeout` and
 * took the "recoverable" path: reload and retry, 5 attempts × (15s + 120s
 * backoff) ≈ eleven minutes per turn, rediscovering the same block every turn.
 *
 * The notice states when it ends, so it can be turned into an exact cooldown.
 */

const NOTICE =
  "Where would you like to begin?\nDue to violation of user policies, your account has been suspended until October 1, 2026 09:21. If you have any questions, please \nContact us\n.";

function fakePage({ body = "", visibleSel = () => false } = {}) {
  return {
    locator: (sel) => ({
      first: () => ({ isVisible: async () => visibleSel(sel) }),
    }),
    evaluate: async () => body,
  };
}

test("the real DeepSeek notice parses to the seconds remaining", () => {
  const now = Date.parse("2026-09-22T00:00:00Z");
  const secs = parseSuspensionSeconds(NOTICE, now);
  assert.ok(secs > 0, "must be a live suspension");
  const days = secs / 86400;
  assert.ok(days > 8 && days < 10, `expected ~9 days, got ${days.toFixed(2)}`);
});

test("an ALREADY EXPIRED suspension is not a live one", () => {
  const now = Date.parse("2026-12-01T00:00:00Z"); // well after the stated end
  assert.equal(parseSuspensionSeconds(NOTICE, now), null);
});

test("an implausibly distant date is treated as unparsed, not honoured", () => {
  // A misparse must not disable a provider for years.
  const text = "your account has been suspended until January 1, 2099 00:00.";
  assert.equal(parseSuspensionSeconds(text, Date.now()), null);
});

test("ordinary prose containing the word 'until' is not a suspension", () => {
  assert.equal(
    parseSuspensionSeconds(
      "Wait until the kettle boils, then pour.",
      Date.now(),
    ),
    null,
  );
});

test("diagnoseBlockedPage reports a suspension with its remaining seconds", async () => {
  const page = fakePage({ body: NOTICE });
  const d = await diagnoseBlockedPage(page, Date.parse("2026-09-22T00:00:00Z"));
  assert.equal(d.kind, "suspended");
  assert.ok(d.seconds > 8 * 86400);
  assert.match(d.notice, /suspended until October 1, 2026/);
});

test("a suspension with NO stated end time still yields a usable cooldown", async () => {
  const page = fakePage({
    body: "Your account has been suspended. Contact support.",
  });
  const d = await diagnoseBlockedPage(page);
  assert.equal(d.kind, "suspended");
  assert.equal(d.seconds, UNKNOWN_SUSPENSION_SECONDS);
});

test("a page WITH a composer is never diagnosed as blocked, whatever its text says", async () => {
  // The false-positive guard: a working provider must never be discarded.
  const page = fakePage({
    body: NOTICE,
    visibleSel: (sel) => sel.includes("textarea"),
  });
  assert.equal(await diagnoseBlockedPage(page), null);
});

test("a sign-in wall is still reported as signedOut, not as a suspension", async () => {
  const page = fakePage({
    body: "Log in to continue",
    visibleSel: (sel) => sel.includes("password"),
  });
  const d = await diagnoseBlockedPage(page);
  assert.equal(d.kind, "signedOut");
});

test("a composerless page with no notice and no sign-in control is NOT diagnosed — a reload may still fix it", async () => {
  assert.equal(await diagnoseBlockedPage(fakePage({ body: "Loading…" })), null);
});

test("deepseek can now be WRITTEN to the cooldown store, and reads back as a real measurement", () => {
  // Before this change deepseek was outside WRITABLE_PROVIDERS, so check()
  // returned {active:null} — "no writer exists", not "measured clear".
  assert.ok(WRITABLE_PROVIDERS.has("deepseek"));
  cooldownManager.trigger("deepseek", 3600);
  const c = cooldownManager.check("deepseek");
  assert.equal(c.active, true);
  assert.ok(c.remainingSeconds > 3500 && c.remainingSeconds <= 3600);
});

test("a provider with no writer still reads null, so the tri-state contract is intact", () => {
  assert.equal(WRITABLE_PROVIDERS.has("nosuchprovider"), false);
  assert.deepEqual(cooldownManager.check("nosuchprovider"), {
    active: null,
    remainingSeconds: null,
  });
});
