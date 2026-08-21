import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeReply } from "../scripts/ia-grade.mjs";

/**
 * T-025: ia-grade.mjs used to carry its own echo detector
 * (`/FORMAT REQUIREMENT|No text extracted/i`) instead of the one
 * vision-probe.mjs already grades replies with. That regex was fitted to the
 * 4 echoes its author had on screen and missed 2 more of a different shape
 * already in the corpus (after-ask.json/mistral, result-ask-qwen.json/qwen)
 * — both then fell into the "SEES=no" bucket, because an echoed prompt
 * contains the prompt's own fallback clause, which is the literal string
 * "SEES=no".
 *
 * gradeReply() (ia-grade.mjs) now decides echo via classify()
 * (vision-probe.mjs) instead of a second hand-typed pattern. Pinned here
 * against the exact shape that was missed: an echoed prompt whose COUNT=
 * placeholder carries no digits, so a naive "does it match COUNT=\d+" test
 * also can't save it — the reply must be recognised as an echo before
 * anything looks for a count.
 */

// The real prompt template (vision-probe.mjs buildPrompt()) reflected back
// verbatim.
const ECHOED_REPLY =
  "Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, " +
  "no other text:\n\n" +
  "SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest " +
  "match from exactly this list: red, blue, green, goldenrod>\n\n" +
  "...or reply with EXACTLY this if you cannot see any image at all:\n\n" +
  "SEES=no";

test("gradeReply buckets an echoed prompt with no digits after COUNT= as echo, not SEES=no", () => {
  const g = gradeReply(ECHOED_REPLY, { count: 4, color: "goldenrod" });
  assert.equal(g.echo, true);
  assert.equal(g.seesNo, false);
  assert.equal(g.said, null);
});

test("the same reply would satisfy a naive /SEES=no/ test — echo must be checked first", () => {
  // This is the trap the old ia-grade.mjs regex fell into: it's not that
  // SEES=no is hard to find in an echo, it's that it's TOO easy to find,
  // because the prompt's own fallback clause contains it verbatim.
  assert.match(ECHOED_REPLY, /SEES\s*=\s*no/i);
});

test("an honest SEES=no (no echo) is still bucketed as seesNo", () => {
  const g = gradeReply("SEES=no", { count: 4, color: "goldenrod" });
  assert.equal(g.echo, false);
  assert.equal(g.seesNo, true);
});
