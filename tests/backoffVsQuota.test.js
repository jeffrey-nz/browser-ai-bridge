import { test } from "node:test";
import assert from "node:assert/strict";
import { cooldownManager } from "../src/session/CooldownManager.js";

/**
 * The rate-limit ladder in routes/ask/executor/index.js is 90s, 90s, 120s,
 * 300s, and its own comment says what it was sized for: "DeepSeek 'Messages too
 * frequent' typically resets in 1-2 min; ChatGPT hourly." Waiting out a PACING
 * limit is what it is for and it is right at that job.
 *
 * It is hopeless against a daily quota. Measured 2026-09-24 with the rest of
 * this change already working — grok's limit detected in 4.5s and a cooldown
 * correctly recorded for 18.5h — the route still logged "waiting 141.23s then
 * retrying in a fresh chat", then 329.883s, then 355.64s, re-submitting the
 * prompt each time into an account that had said in writing to come back
 * tomorrow. One request burned over ten minutes that way.
 *
 * The ladder's entire budget is ten minutes, so a stated wait longer than that
 * makes every rung futile by construction. These pin the comparison rather than
 * the literals, so re-tuning the ladder cannot silently break the rule.
 */

const LADDER_MS = [90000, 90000, 120000, 300000];
// The jitter is 0.75-1.25, so the smallest budget the ladder can have.
const MIN_BUDGET_MS = LADDER_MS.reduce((a, b) => a + b, 0) * 0.75;

function reset(id) {
  cooldownManager.cooldowns.delete(id);
  cooldownManager.reasons.delete(id);
}

test("grok's real 18.5h quota dwarfs the ladder's whole budget", () => {
  const quotaMs = 18.5 * 3600 * 1000;
  assert.ok(
    quotaMs > MIN_BUDGET_MS * 100,
    `18.5h is ${(quotaMs / MIN_BUDGET_MS).toFixed(0)}x the back-off budget`,
  );
});

test("a recorded quota longer than the budget is visible to the executor's check", () => {
  reset("grok");
  cooldownManager.trigger("grok", 18 * 3600, "18 hours 29 minutes before limit is gone");
  const cd = cooldownManager.check("grok");
  assert.equal(cd.active, true);
  assert.ok(cd.remainingSeconds * 1000 > MIN_BUDGET_MS, "must read as out of reach");
  assert.match(cd.reason, /before limit is gone/);
  reset("grok");
});

test("a SHORT pacing cooldown stays inside the ladder's reach — it must still wait", () => {
  //[[ The half that must not regress. deepseek's "Messages too frequent" clears
  //   in a minute or two, and abandoning the ladder for that would throw away a
  //   provider that was about to work. ]]
  reset("deepseek");
  cooldownManager.trigger("deepseek", 90);
  const cd = cooldownManager.check("deepseek");
  assert.ok(
    cd.remainingSeconds * 1000 < MIN_BUDGET_MS,
    "90s must remain within the back-off budget",
  );
  reset("deepseek");
});

test("no cooldown recorded leaves the ladder untouched", () => {
  reset("grok");
  assert.equal(cooldownManager.check("grok").active, false);
});

test("an unwritable provider reads null, not false — the ladder must not be skipped on a non-reading", () => {
  //[[ T-097's tri-state. `active: null` means nothing ever wrote a cooldown for
  //   this id, which is not evidence that the provider is fine. The executor's
  //   guard tests `cd?.active` truthiness, so null correctly means "no reason to
  //   skip the ladder" rather than being mistaken for a measurement. ]]
  const cd = cooldownManager.check("not-a-provider");
  assert.equal(cd.active, null);
});
