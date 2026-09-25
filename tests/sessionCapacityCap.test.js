import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANAGER = fs.readFileSync(
  path.join(HERE, "..", "src", "session", "Manager.js"),
  "utf8",
);

/**
 * THE PER-PROVIDER CAP WAS A CLEANING RULE, NOT A LIMIT.
 *
 * MAX_TABS_PER_PROVIDER lived only in TabJanitor, which SWEEPS — and its
 * over-cap rule can only evict sessions that are NOT locked. Nothing capped
 * CREATION, so while every session for a provider was busy, each new request
 * opened another tab. The ceiling was only ever enforced against providers that
 * were already idle, which is precisely when it was not needed.
 *
 * Measured 2026-09-24 generating tl-en/learn-tagalog, with the race cut to a
 * single primary so there were no losers at all: tabs climbed 19 -> 30 over five
 * minutes, gemini, chatgpt and perplexity each holding five to seven sessions,
 * every one LOCKED, against a stated cap of 3. Reducing racers had not helped
 * because racing was never the source.
 *
 * After the cap: 21 -> 12 tabs, "perplexity freed a session after 4s — no extra
 * tab opened", and no provider over its cap.
 */

test("creation consults the same per-provider cap the janitor reports", () => {
  assert.match(
    MANAGER,
    /TAB_LIMITS\.maxSessionsPerProvider/,
    "the limit must be the one limit, not a second number that can drift",
  );
});

test("a caller WAITS for a session rather than opening another tab", () => {
  assert.match(MANAGER, /waiting for one instead of opening another tab/);
  assert.match(MANAGER, /CAPACITY_WAIT_MS/);
});

test("the wait ends in an explicit error, not an unbounded hang", () => {
  //[[ A queue in front of a browser may make a caller wait; it may not make one
  //   wait forever. The client's own cycle/retry treats a 503 as transient. ]]
  assert.match(MANAGER, /err\.status = 503/);
  assert.match(MANAGER, /none became free within/);
});

test("an unlocked session does NOT let a caller past the cap", () => {
  //[[ The hole the first attempt had, and the reason tabs kept growing through
  //   it: it waited only when the provider was at capacity AND had no unlocked
  //   session, on the reasoning that a free one could be reused. Nothing here
  //   reuses a registry session — the idle sweep CLOSES them, and sessionPool is
  //   a separate standby pool — so a single unlocked session let every new
  //   request past. Measured after that fix shipped: chatgpt 5 and perplexity 4,
  //   against a cap of 3. ]]
  assert.doesNotMatch(
    MANAGER,
    /atCapacity\(\) && !hasFree\(\)/,
    "capacity alone must decide, or one idle session reopens the hole",
  );
  assert.match(MANAGER, /if \(atCapacity\(\)\) \{/);
});

test("the wait reaps idle sessions so it can actually end", () => {
  //[[ Waiting on capacity alone only terminates if something frees capacity. An
  //   unlocked session past the grace window IS capacity, so the loop closes
  //   those rather than spinning until the budget runs out. ]]
  assert.match(MANAGER, /const reapIdle = async \(\)/);
  assert.match(MANAGER, /if \(!\(await reapIdle\(\)\)\)/);
});

test("the wait budget is overridable but has a sane default", () => {
  assert.match(MANAGER, /SESSION_CAPACITY_WAIT_MS \?\? 120000/);
});
