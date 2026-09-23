import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLimitCountdown,
  limitNotice,
  UNKNOWN_LIMIT_SECONDS,
} from "../src/ai/shared/usageLimit.js";

/**
 * grok.com prints how long its daily limit has left to run, and until
 * 2026-09-24 nothing read it. The poll detected the limit and discarded the
 * number; the only cooldown applied anywhere was a flat five minutes, against a
 * nineteen-hour limit.
 *
 * The cost was visible in the tab list at the moment it was found: TEN grok
 * tabs, countdowns reading 18h49m, 18h50m, 18h51m … 18h56m — one per minute,
 * each a new tab and a full wasted turn to rediscover what the first page had
 * already printed, and set to continue for nineteen hours.
 */

test("the exact string grok printed, 2026-09-24", () => {
  assert.equal(
    parseLimitCountdown("18 hours 49 minutes before limit is gone"),
    18 * 3600 + 49 * 60,
  );
});

test("the five-minute cooldown it used to get was off by more than two orders of magnitude", () => {
  // Not decoration: this is the size of the bug, and it is why a "cooldown
  // already exists" reading of the old behaviour was wrong.
  const real = parseLimitCountdown("18 hours 49 minutes before limit is gone");
  assert.ok(real / (5 * 60) > 200, `${real}s vs 300s`);
});

test("the whole notice block parses, not just a bare line", () => {
  const page = [
    "Grok 4",
    "18 hours 49 minutes before limit is gone",
    "Wait or upgrade to SuperGrok for much higher limits and premium features.",
    "Upgrade to SuperGrok",
  ].join("\n");
  assert.equal(parseLimitCountdown(page), 18 * 3600 + 49 * 60);
  assert.match(limitNotice(page), /18 hours 49 minutes/);
});

test("minutes only, and hours only", () => {
  assert.equal(parseLimitCountdown("45 minutes before limit is gone"), 45 * 60);
  assert.equal(parseLimitCountdown("2 hours before limit is gone"), 2 * 3600);
});

test("other providers' phrasings for the same thing", () => {
  assert.equal(parseLimitCountdown("You've hit your limit. Try again in 3 hours."), 3 * 3600);
  assert.equal(parseLimitCountdown("Rate limit reached — retry in 90 seconds"), 90);
  assert.equal(parseLimitCountdown("Message limit reached. Resets in 1 hour 30 minutes."), 5400);
});

test("a duration is only read from a line that is ABOUT a limit", () => {
  //[[ The guard that keeps a provider alive. Dialogue this bridge carries is
  //   full of durations — the Malay book it was generating when this was found
  //   has "Kita kena tunggu" lines and travel times all through it. A number on
  //   a line with no limit wording must never bench anybody. ]]
  assert.equal(parseLimitCountdown("The train leaves in 2 hours."), null);
  assert.equal(parseLimitCountdown("Kita kena tunggu 30 minit lagi."), null);
  assert.equal(parseLimitCountdown("He waited 18 hours 49 minutes for a reply."), null);
});

test("no countdown at all reads as null, so the caller can choose the fallback", () => {
  assert.equal(parseLimitCountdown("Message limit reached"), null);
  assert.equal(parseLimitCountdown(""), null);
  assert.equal(parseLimitCountdown(null), null);
});

test("an implausible span is a parse failure, not a week-long bench", () => {
  assert.equal(parseLimitCountdown("limit is gone in 9000 hours"), null);
});

test("zero is not a cooldown", () => {
  assert.equal(parseLimitCountdown("0 minutes before limit is gone"), null);
});

test("the unknown fallback is minutes, not the five that caused this, and not a day", () => {
  //[[ Pins the judgement rather than the number: long enough to break a
  //   once-a-minute retry storm, short enough not to write off a brief limit. ]]
  assert.ok(UNKNOWN_LIMIT_SECONDS > 5 * 60, "must beat the old flat 5 minutes");
  assert.ok(UNKNOWN_LIMIT_SECONDS < 60 * 60, "a guess must not bench for an hour");
});
