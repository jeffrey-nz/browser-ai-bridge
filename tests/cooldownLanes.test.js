import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cooldownManager, cooldownKey } from "../src/session/CooldownManager.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, "..", "src", ...p), "utf8");

/**
 * A QUOTA BELONGS TO A MODEL, NOT ALWAYS TO A SITE.
 *
 * Cooldowns were keyed on the provider id, so a throttle on gemini benched
 * gemini — all of it. gemini.google.com offers Fast, Thinking and Pro on
 * separate quotas: running out of Fast says nothing about whether Thinking will
 * answer. Measured 2026-09-24 with gemini on cooldown, asking for mode "pro"
 * and mode "thinking" were BOTH refused in 0s, though neither had been
 * throttled.
 */

test("a mode makes its own lane; no mode and auto are the site's default lane", () => {
  assert.equal(cooldownKey("gemini", "pro"), "gemini:pro");
  assert.equal(cooldownKey("gemini", "thinking"), "gemini:thinking");
  assert.equal(cooldownKey("gemini", null), "gemini");
  assert.equal(cooldownKey("gemini", "auto"), "gemini",
    'auto means "whatever the site gives me", which is the site\'s own lane');
});

test("THE POINT: throttling one lane leaves the other modes answerable", () => {
  for (const k of ["gemini", "gemini:fast", "gemini:pro", "gemini:thinking"]) {
    cooldownManager.cooldowns.delete(k);
    cooldownManager.reasons.delete(k);
  }
  cooldownManager.trigger(cooldownKey("gemini", "fast"), 3600, "out of Fast");
  assert.equal(cooldownManager.check("gemini:fast").active, true);
  assert.equal(cooldownManager.check("gemini:pro").active, false);
  assert.equal(cooldownManager.check("gemini:thinking").active, false);
  for (const k of ["gemini:fast"]) cooldownManager.cooldowns.delete(k);
});

test("a lane is writable exactly when its SITE is — the tri-state still holds", () => {
  //[[ T-097: `null` means nothing can ever write a cooldown for this id, which
  //   is not the same as a measured "not cooling down". A lane must inherit that
  //   from its base provider rather than reading null for every mode. ]]
  assert.equal(cooldownManager.check("gemini:pro").active, false, "gemini is writable, so its lanes are");
  assert.equal(cooldownManager.check("notaprovider:pro").active, null);
  assert.equal(cooldownManager.check("notaprovider").active, null);
});

test("the request gate consults the lane, not just the site", () => {
  assert.match(read("routes", "ask", "validation.js"),
    /cooldownManager\.check\(cooldownKey\(checkId \|\| provider, req\?\.body\?\.mode\)\)/);
});

test("the cooldown is recorded where the MODE is known — the executor, not promptWorkflow", () => {
  //[[ promptWorkflow detects the limit but never sees the session, so it cannot
  //   know which mode was throttled; recording there benched the whole site. ]]
  assert.match(read("routes", "ask", "executor", "index.js"),
    /cooldownKey\(session\.providerId, session\.mode\)/);
  assert.doesNotMatch(read("ai", "shared", "promptWorkflow.js"),
    /cooldownManager\.trigger\(\s*cooldownKey/,
    "the rate-limit trigger belongs to the executor now");
});

test("the session remembers its mode, or the executor has nothing to key on", () => {
  assert.match(read("session", "Manager.js"), /session\.mode = mode \|\| null/);
});

test("the span and the notice are carried up for the executor to record", () => {
  const wf = read("ai", "shared", "promptWorkflow.js");
  assert.match(wf, /cooldownSeconds: err\.cooldownSeconds/);
  assert.match(wf, /limitNotice: err\.limitNotice/);
});
