import test from "node:test";
import assert from "node:assert/strict";
import { classify, MIN_COUNT, COUNT_RANGE } from "../scripts/vision-probe.mjs";

const MAX_COUNT = MIN_COUNT + COUNT_RANGE - 1;

// T-076: a WRONG count outside MIN_COUNT..MAX_COUNT names a picture the
// generator could never have drawn — strictly stronger than "got it
// wrong". outOfRange must be derived from these exported constants, not a
// second "3 to 9" — this test pins the boundary values specifically
// (MIN_COUNT and MAX_COUNT themselves must NOT be flagged) so a future
// off-by-one in the comparison operators is caught here rather than
// silently mis-flagging a genuine near-miss as a fabrication or vice
// versa.
test.describe("classify — outOfRange", () => {
  test("a WRONG count at exactly MIN_COUNT is in range", () => {
    const truth = { count: MIN_COUNT + 1, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MIN_COUNT} COLOR=teal`, truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.outOfRange, false);
  });

  test("a WRONG count at exactly MAX_COUNT is in range", () => {
    const truth = { count: MAX_COUNT - 1, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MAX_COUNT} COLOR=teal`, truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.outOfRange, false);
  });

  test("one below MIN_COUNT is out of range", () => {
    const truth = { count: MIN_COUNT, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MIN_COUNT - 1} COLOR=teal`, truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.outOfRange, true);
  });

  test("one above MAX_COUNT is out of range", () => {
    const truth = { count: MAX_COUNT, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MAX_COUNT + 1} COLOR=teal`, truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.outOfRange, true);
  });

  test("a correct COUNT (PASS) never carries outOfRange", () => {
    const truth = { count: MIN_COUNT, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MIN_COUNT} COLOR=teal`, truth);
    assert.equal(g.shape, "PASS");
    assert.equal("outOfRange" in g, false);
  });

  test("COUNT_ONLY (right count, wrong colour) never carries outOfRange", () => {
    const truth = { count: MIN_COUNT, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MIN_COUNT} COLOR=purple`, truth);
    assert.equal(g.shape, "COUNT_ONLY");
    assert.equal("outOfRange" in g, false);
  });

  test("outOfRange is always present (true or false), never omitted, on WRONG", () => {
    const truth = { count: MIN_COUNT + 1, color: "teal" };
    const g = classify(`SEES=yes COUNT=${MIN_COUNT} COLOR=teal`, truth);
    assert.equal(g.shape, "WRONG");
    assert.equal("outOfRange" in g, true);
    assert.equal(typeof g.outOfRange, "boolean");
  });
});

// T-086: colorOk alone conflates two different disagreements — "named a
// different real palette colour" versus "reached for a word not on the
// list at all" (measured: 5 of 5 recorded colorOk=false rows in this
// corpus have been the second kind). onList separates them, mechanically
// derived from COLORS, and — same rule T-076 already set for outOfRange —
// always present, true or false, never omitted on a structured reply.
test.describe("classify — onList", () => {
  test("PASS always carries onList=true (the stated word IS the truth, which is always a palette member)", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=5 COLOR=teal", truth);
    assert.equal(g.shape, "PASS");
    assert.equal(g.onList, true);
  });

  test("COUNT_ONLY with an off-list word: onList=false, detail says 'not on the list'", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=5 COLOR=purple", truth);
    assert.equal(g.shape, "COUNT_ONLY");
    assert.equal(g.onList, false);
    assert.match(g.detail, /not on the list/);
  });

  test("COUNT_ONLY with a DIFFERENT real palette colour: onList=true, detail says so, not 'not on the list'", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=5 COLOR=crimson", truth);
    assert.equal(g.shape, "COUNT_ONLY");
    assert.equal(g.onList, true);
    assert.match(g.detail, /different listed colour/);
    assert.doesNotMatch(g.detail, /not on the list/);
  });

  test("WRONG with an off-list word: onList=false", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=6 COLOR=purple", truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.onList, false);
    assert.match(g.detail, /COLOR is not on the list/);
  });

  test("WRONG with a DIFFERENT real palette colour: onList=true", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=6 COLOR=crimson", truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.onList, true);
    assert.match(g.detail, /COLOR is a different listed colour/);
  });

  test("WRONG with the right colour (only COUNT wrong): onList=true, no colour caveat appended", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=6 COLOR=teal", truth);
    assert.equal(g.shape, "WRONG");
    assert.equal(g.colorOk, true);
    assert.equal(g.onList, true);
    assert.doesNotMatch(g.detail, /different listed colour|not on the list/);
  });

  test("onList is case-insensitive, matching how colorOk itself compares", () => {
    const truth = { count: 5, color: "teal" };
    const g = classify("SEES=yes COUNT=5 COLOR=TEAL", truth);
    assert.equal(g.shape, "PASS");
    assert.equal(g.onList, true);
  });
});

// T-101: classify()'s structured-reply branch used to dereference
// `truth.count`/`truth.color` unconditionally, throwing on an absent truth.
// Two callers already worked around it at the call site (shape-audit.mjs's
// blind-row ternary, ia-grade.mjs's gradeBlindReply() sentinel) rather than
// at the fault — and the workaround only covered a WHOLLY absent truth,
// not an incomplete one ({} would still crash on colour). classify() must
// now return a real shape, never throw, for every raw form the corpus
// contains, under every way "no truth" can arrive: undefined, null, {}.
test.describe("classify — absent or incomplete truth does not throw (T-101)", () => {
  for (const [label, truth] of [
    ["undefined", undefined],
    ["null", null],
    ["{}", {}],
  ]) {
    test(`structured reply, truth=${label}: WRONG, not a throw — nothing to compare against`, () => {
      const g = classify("SEES=yes COUNT=4 COLOR=teal", truth);
      assert.equal(g.shape, "WRONG");
      assert.equal(g.countOk, false);
      assert.equal(g.colorOk, false);
    });

    test(`bare SEES=no, truth=${label}: SEES_NO`, () => {
      assert.deepEqual(classify("SEES=no", truth), { shape: "SEES_NO" });
    });

    test(`echo, truth=${label}: ECHO`, () => {
      const echoed =
        "Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, no other text.";
      assert.deepEqual(classify(echoed, truth), { shape: "ECHO" });
    });

    test(`empty reply, truth=${label}: NO_ANSWER`, () => {
      const g = classify("", truth);
      assert.equal(g.shape, "NO_ANSWER");
    });
  }

  test("structured reply with truth={} behaves identically to truth=undefined", () => {
    assert.deepEqual(
      classify("SEES=yes COUNT=4 COLOR=teal", {}),
      classify("SEES=yes COUNT=4 COLOR=teal", undefined),
    );
  });
});
