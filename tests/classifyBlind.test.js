import test from "node:test";
import assert from "node:assert/strict";
import { classifyBlind } from "../scripts/vision-probe.mjs";

// T-072: classifyBlind() is what askProviderBlind() grades a blind reply
// with — no picture exists to grade COUNT/COLOR correctness against, only
// whether a count was STATED at all. The sentinel truth ({count: null,
// color: ""}) must never crash on a structured reply (a naive `truth.color
// .toLowerCase()` on an undefined truth.color would throw) and must never
// register a real stated count as "right" by chance.
test.describe("classifyBlind", () => {
  test("SEES=no: refused, stated null", () => {
    const r = classifyBlind("SEES=no");
    assert.equal(r.shape, "SEES_NO");
    assert.equal(r.stated, null);
  });

  test("a structured reply: informative shape, stated is the real number", () => {
    const r = classifyBlind("SEES=yes COUNT=6 COLOR=teal");
    assert.notEqual(r.shape, "ECHO");
    assert.notEqual(r.shape, "SEES_NO");
    assert.equal(r.stated, 6);
  });

  test("an echoed prompt: shape ECHO, stated null (not garbage from the placeholder text)", () => {
    const echoed =
      "Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, " +
      "no other text:\n\n" +
      "SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest " +
      "match from exactly this list: crimson, teal, goldenrod, indigo>\n\n" +
      "...or reply with EXACTLY this if you cannot see any image at all:\n\n" +
      "SEES=no";
    const r = classifyBlind(echoed);
    assert.equal(r.shape, "ECHO");
    assert.equal(r.stated, null);
  });

  test("empty reply: NO_ANSWER, stated null", () => {
    const r = classifyBlind("");
    assert.equal(r.shape, "NO_ANSWER");
    assert.equal(r.stated, null);
  });
});
