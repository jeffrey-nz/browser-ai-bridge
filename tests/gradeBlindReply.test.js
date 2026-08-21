import test from "node:test";
import assert from "node:assert/strict";
import { gradeBlindReply } from "../scripts/ia-grade.mjs";

// T-072: ia-grade.mjs's section 5 reads blind rows (vision-probe.mjs
// --blind) through gradeBlindReply — the truth-less counterpart to
// gradeReply, recomputed fresh from `raw` (T-027's policy) rather than
// trusting a stored shape. Mirrors classifyBlind.test.js's cases for
// vision-probe.mjs's own classifyBlind(), since section 5's numbers must
// agree with what the tool that WROTE the row would have said.
test.describe("gradeBlindReply", () => {
  test("SEES=no: refused, stated null", () => {
    const g = gradeBlindReply("SEES=no");
    assert.equal(g.shape, "SEES_NO");
    assert.equal(g.stated, null);
  });

  test("a structured reply: informative shape, stated is the real number", () => {
    const g = gradeBlindReply("SEES=yes COUNT=1 COLOR=goldenrod");
    assert.notEqual(g.shape, "ECHO");
    assert.equal(g.stated, 1);
  });

  test("an echoed prompt: shape ECHO, stated null", () => {
    const echoed =
      "Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, " +
      "no other text:\n\n" +
      "SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest " +
      "match from exactly this list: crimson, teal, goldenrod, indigo>\n\n" +
      "...or reply with EXACTLY this if you cannot see any image at all:\n\n" +
      "SEES=no";
    const g = gradeBlindReply(echoed);
    assert.equal(g.shape, "ECHO");
    assert.equal(g.stated, null);
  });

  test("null/undefined raw: NO_ANSWER, stated null (does not throw)", () => {
    const g = gradeBlindReply(null);
    assert.equal(g.shape, "NO_ANSWER");
    assert.equal(g.stated, null);
  });
});
