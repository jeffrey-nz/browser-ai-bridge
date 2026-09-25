import { test } from "node:test";
import assert from "node:assert/strict";
import { looksComplete } from "../src/ai/shared/domInteraction/clearAndType.js";

/**
 * The bridge's worst failure shape is not an error — it is a plausible answer to
 * a prompt that was never delivered.
 *
 * Every injection strategy in clearAndType used to accept its own result on
 * evidence that does not scale with the prompt. Strategy 0 asked for
 * `afterFill.length >= Math.min(payload.length, 50)`, which for a 9,868-character
 * book prompt is a threshold of FIFTY CHARACTERS; strategies 1 and 2 asked only
 * for `length > 0`. So a composer holding a fragment counted as injected, the
 * fragment was sent, and whatever came back was returned as the answer.
 *
 * Measured 2026-09-24: mistral, given the 9.9KB chapter-23 quiz prompt, replied
 * "Hello, Jeffrey! How can I assist you today?" — with `success: true`. kimi
 * failed the identical prompt loudly ("input did not clear and generation did
 * not start"), which is strictly better: a caller can retry an error and cannot
 * detect a confident answer to the wrong question.
 *
 * These pin the threshold, and pin the slack it deliberately keeps.
 */

test("the exact bug: 50 chars of a 9,868-char book prompt is NOT a delivered prompt", () => {
  const prompt = "x".repeat(9868);
  assert.equal(looksComplete("y".repeat(50), prompt), false);
});

test("the old rule would have accepted it — the fixture proves the bug was real", () => {
  // What `Math.min(payload.length, 50)` evaluated to for this prompt.
  const prompt = "x".repeat(9868);
  assert.equal(Math.min(prompt.length, 50), 50);
  assert.ok("y".repeat(50).length >= Math.min(prompt.length, 50));
});

test("a fully delivered prompt passes", () => {
  const prompt = "x".repeat(9868);
  assert.equal(looksComplete(prompt, prompt), true);
});

test("normal editor mangling still passes — the 10% slack is the point", () => {
  //[[ These composers legitimately alter what they hold: collapsing runs of
  //   whitespace, normalising newlines, and readValue trims on top. Requiring an
  //   exact length would fail healthy injections, which is the failure mode this
  //   fix must not introduce. ]]
  const prompt = "x".repeat(10000);
  assert.equal(
    looksComplete("x".repeat(9500), prompt),
    true,
    "5% shorter is fine",
  );
  assert.equal(
    looksComplete("x".repeat(9000), prompt),
    true,
    "exactly 10% shorter is fine",
  );
});

test("half a prompt is refused — well outside anything trimming explains", () => {
  const prompt = "x".repeat(10000);
  assert.equal(looksComplete("x".repeat(5000), prompt), false);
});

test("an empty composer is refused for a non-empty prompt", () => {
  assert.equal(looksComplete("", "a real prompt"), false);
});

test("an empty payload is vacuously complete, so a clear-only call is not an error", () => {
  assert.equal(looksComplete("", ""), true);
});

test("short prompts are not made harder to satisfy than they were", () => {
  //[[ Guards against over-tightening: a one-word ping must still inject cleanly.
  //   PONG-sized prompts are how the bridge is health-checked. ]]
  const prompt = "Reply with the single word PONG.";
  assert.equal(looksComplete(prompt, prompt), true);
});

/**
 * A READABLE composer holding a fragment is refused; an EMPTY read is not.
 *
 * Measured 2026-09-24, after the ratio check above was already in place: mistral
 * still ended with "composer holds 1 of 9868 chars" and answered "It seems like
 * you might have started typing something. Could you clarify?" — success: true.
 * The ratio check made the fault VISIBLE; it did not stop the send.
 *
 * The distinction matters and is not cosmetic. readValue() returns "" for
 * composers it cannot read, and in the same bridge log 2 of the 8 turns that
 * warned "input still empty" went on to answer correctly. Refusing on an empty
 * read would break working providers to fix a broken one.
 */
import { REFUSE_BELOW_RATIO } from "../src/ai/shared/domInteraction/clearAndType.js";

test("the refusal threshold sits far below the warn threshold, with ordinary mangling between", () => {
  assert.ok(
    REFUSE_BELOW_RATIO < 0.9,
    "must not refuse what looksComplete merely warns about",
  );
  assert.ok(
    REFUSE_BELOW_RATIO <= 0.25,
    "a quarter is already far past any whitespace tidying",
  );
  assert.ok(REFUSE_BELOW_RATIO > 0, "zero would make the rule unreachable");
});

test("mistral's real measurement falls well inside the refusal band", () => {
  const held = 1;
  const payload = 9868;
  assert.ok(held > 0, "readable, not an unreadable empty");
  assert.ok(held < payload * REFUSE_BELOW_RATIO, "1 of 9868 must refuse");
});

test("an editor that collapses whitespace warns but is NOT refused", () => {
  const payload = 10000;
  for (const held of [9500, 9000, 8000, 6000]) {
    assert.ok(
      held >= payload * REFUSE_BELOW_RATIO,
      `${held}/${payload} must not refuse`,
    );
  }
});

test("the refusal message is one promptWorkflow already treats as recoverable", () => {
  //[[ RECOVERABLE_RE decides whether the workflow reloads and retries or lets the
  //   error escape raw. "Failed to submit prompt" is the phrase kimi's loud
  //   failure already uses, so this joins that path rather than inventing one. ]]
  const RECOVERABLE_RE =
    /Failed to submit prompt|waiting for locator|Timeout .* exceeded|element is not (visible|attached)|Target (page|frame).* has been closed/i;
  const message =
    "Failed to submit prompt: the composer holds 1 of 9868 characters. " +
    "Sending it would ask a different question from the one requested.";
  assert.ok(RECOVERABLE_RE.test(message));
});
