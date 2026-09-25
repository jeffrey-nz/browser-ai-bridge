import { test } from "node:test";
import assert from "node:assert/strict";
import { cooldownMessage } from "../src/routes/ask/validation.js";
import { cooldownManager } from "../src/session/CooldownManager.js";

/**
 * The 429 told every caller the provider was "on cooldown to prevent UI bans".
 * True when gemini's 120s pacing was the only writer; wrong for the case that
 * now dominates. Measured 2026-09-24: grok's cooldown is a DAILY quota the
 * provider itself declared — "18 hours 49 minutes before limit is gone" — and a
 * caller told only to "try again later" cannot tell a two-minute pacing pause
 * from a lost day, which are different decisions.
 */

test("a quota-length cooldown says out of quota, names the span, and says not to retry", () => {
  const msg = cooldownMessage("grok", {
    active: true,
    remainingSeconds: 18 * 3600 + 49 * 60,
    reason: "18 hours 49 minutes before limit is gone",
  });
  assert.match(msg, /out of quota/i);
  assert.match(msg, /18\.8h/);
  assert.match(msg, /cannot succeed/i);
  assert.match(msg, /18 hours 49 minutes before limit is gone/);
});

test("a short pacing pause keeps the old, correct wording", () => {
  //[[ gemini's 120s is still a real case and must not be relabelled a quota. ]]
  const msg = cooldownMessage("gemini", {
    active: true,
    remainingSeconds: 120,
  });
  assert.match(msg, /on cooldown/i);
  assert.match(msg, /2 min/);
  assert.doesNotMatch(msg, /out of quota/i);
});

test("no reason recorded still produces a usable sentence", () => {
  const msg = cooldownMessage("grok", { active: true, remainingSeconds: 7200 });
  assert.match(msg, /out of quota/i);
  assert.match(msg, /2\.0h/);
  assert.doesNotMatch(msg, /—\s*$/, "no dangling dash when there is no reason");
});

test("the reason round-trips through CooldownManager and expires with it", () => {
  cooldownManager.cooldowns.delete("grok");
  cooldownManager.reasons.delete("grok");

  cooldownManager.trigger(
    "grok",
    3600,
    "18 hours 49 minutes before limit is gone",
  );
  const live = cooldownManager.check("grok");
  assert.equal(live.active, true);
  assert.match(live.reason, /before limit is gone/);

  // An expired cooldown must not leave its reason behind for the next one.
  cooldownManager.cooldowns.set("grok", Date.now() - 1000);
  const lapsed = cooldownManager.check("grok");
  assert.equal(lapsed.active, false);
  assert.equal(cooldownManager.reasons.has("grok"), false);

  cooldownManager.cooldowns.delete("grok");
  cooldownManager.reasons.delete("grok");
});

test("trigger without a reason clears any stale one rather than inheriting it", () => {
  cooldownManager.trigger("grok", 3600, "an old reason");
  cooldownManager.trigger("grok", 3600);
  assert.equal(cooldownManager.check("grok").reason, undefined);
  cooldownManager.cooldowns.delete("grok");
  cooldownManager.reasons.delete("grok");
});
