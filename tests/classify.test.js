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

// T-089: onList (T-086) told "named a different palette member" apart from
// "named an off-list word", but the off-list bucket was itself two things —
// a synonym for the true colour, and a word naming a different colour (or a
// non-reading) entirely. adjudicateColorWord (via classify()'s own fields)
// resolves the said word to RGB (scripts/cssColorTable.json, GENERATED —
// see its own header) and asks which COLORS member it is nearest to.
test.describe("classify — colorUnresolved / nearestPaletteMember (T-089)", () => {
  test("a real palette member (onList=true): colorUnresolved false, no nearest-member fields", () => {
    const g = classify("SEES=yes COUNT=5 COLOR=teal", {
      count: 9,
      color: "crimson",
    });
    assert.equal(g.shape, "WRONG");
    assert.equal(g.onList, true);
    assert.equal(g.colorUnresolved, false);
    assert.equal(g.nearestPaletteMember, null);
    assert.equal(g.nearestPaletteDistance, null);
  });

  test("PASS: colorUnresolved false, no nearest-member fields (colorOk true implies onList true)", () => {
    const g = classify("SEES=yes COUNT=5 COLOR=crimson", {
      count: 5,
      color: "crimson",
    });
    assert.equal(g.shape, "PASS");
    assert.equal(g.onList, true);
    assert.equal(g.colorUnresolved, false);
    assert.equal(g.nearestPaletteMember, null);
    assert.equal(g.nearestPaletteDistance, null);
  });

  test("a synonym (goldenrod said as 'yellow'), COUNT correct: COUNT_ONLY, nearest member goldenrod — the exact shape T-086 measured", () => {
    const g = classify("SEES=yes COUNT=3 COLOR=yellow", {
      count: 3,
      color: "goldenrod",
    });
    assert.equal(g.shape, "COUNT_ONLY");
    assert.equal(g.colorOk, false); // UNCHANGED — this adds a record, not leniency
    assert.equal(g.onList, false);
    assert.equal(g.colorUnresolved, false);
    assert.equal(g.nearestPaletteMember, "goldenrod");
    assert.ok(
      Math.abs(g.nearestPaletteDistance - 102.4) < 0.5,
      `expected ~102.4, got ${g.nearestPaletteDistance}`,
    );
    assert.match(g.detail, /nearest palette member goldenrod/);
  });

  test("a non-reading (goldenrod said as 'black'), COUNT wrong too: WRONG, nearest member is a DIFFERENT colour (indigo) — the exact shape T-086 measured", () => {
    const g = classify("SEES=yes COUNT=6 COLOR=black", {
      count: 3,
      color: "goldenrod",
    });
    assert.equal(g.shape, "WRONG");
    assert.equal(g.colorOk, false);
    assert.equal(g.onList, false);
    assert.equal(g.colorUnresolved, false);
    assert.equal(g.nearestPaletteMember, "indigo");
    assert.notEqual(g.nearestPaletteMember, "goldenrod");
    // Distance to the WINNING member (indigo), not to the truth colour
    // (goldenrod, d=275.3 — a different number, reported nowhere here since
    // classify() has no reference to truth.color's own distance from the
    // said word, only to its nearest member).
    assert.ok(
      Math.abs(g.nearestPaletteDistance - 150.1) < 0.5,
      `expected ~150.1, got ${g.nearestPaletteDistance}`,
    );
  });

  test("a word the table cannot resolve at all: colorUnresolved true, never treated as a colour error the other two states are", () => {
    const g = classify("SEES=yes COUNT=5 COLOR=zibblequorf", {
      count: 9,
      color: "crimson",
    });
    assert.equal(g.shape, "WRONG");
    assert.equal(g.onList, false);
    assert.equal(g.colorUnresolved, true);
    assert.equal(g.nearestPaletteMember, null);
    assert.equal(g.nearestPaletteDistance, null);
    assert.match(g.detail, /not a resolvable colour word/);
  });

  // Clause 2's own requirement, proved rather than stated: resolving an
  // off-list word to its nearest palette member must never flip colorOk —
  // no reply that failed before this ticket may start passing now.
  test("resolving to the CORRECT nearest member does not make colorOk true — this adds a record, not leniency", () => {
    const g = classify("SEES=yes COUNT=3 COLOR=yellow", {
      count: 3,
      color: "goldenrod",
    });
    assert.equal(g.nearestPaletteMember, "goldenrod"); // resolves to the TRUE colour
    assert.equal(g.colorOk, false); // and still fails — onList/exact-string is unchanged
    assert.equal(g.shape, "COUNT_ONLY"); // not PASS
  });

  // Clause 4: the 5 recorded colour disagreements, re-adjudicated by classify()
  // ITSELF (not a diagnostic script) — reproducing T-086's own 5-of-5 table.
  test("all 5 recorded colour disagreements, re-adjudicated by classify() — reproduces T-086's 5-of-5 table", () => {
    const cases = [
      {
        provider: "zai",
        truth: { count: 6, color: "crimson" },
        raw: "SEES=yes COUNT=6 COLOR=red",
        countOk: true,
        expectNearest: "crimson",
      },
      {
        provider: "gemini",
        truth: { count: 3, color: "goldenrod" },
        raw: "SEES=yes COUNT=3 COLOR=yellow",
        countOk: true,
        expectNearest: "goldenrod",
      },
      {
        provider: "grok",
        truth: { count: 3, color: "goldenrod" },
        raw: "SEES=yes COUNT=3 COLOR=yellow",
        countOk: true,
        expectNearest: "goldenrod",
      },
      {
        provider: "copilot",
        truth: { count: 3, color: "goldenrod" },
        raw: "SEES=yes COUNT=3 COLOR=yellow",
        countOk: true,
        expectNearest: "goldenrod",
      },
      {
        provider: "deepseek",
        truth: { count: 3, color: "goldenrod" },
        raw: "SEES=yes COUNT=6 COLOR=black",
        countOk: false,
        expectNearest: "indigo",
      },
    ];
    for (const c of cases) {
      const g = classify(c.raw, c.truth);
      assert.equal(g.countOk, c.countOk, `${c.provider}: countOk`);
      assert.equal(
        g.nearestPaletteMember,
        c.expectNearest,
        `${c.provider}: nearestPaletteMember`,
      );
      // The claim this ticket rests on: nearest-member agrees with COUNT —
      // right on every synonym (nearest === truth.color), wrong on the one
      // non-reading (nearest !== truth.color) — same split, two instruments
      // sharing no feature.
      const nearestAgreesWithTruth = g.nearestPaletteMember === c.truth.color;
      assert.equal(
        nearestAgreesWithTruth,
        c.countOk,
        `${c.provider}: nearest-member-agrees-with-truth should match countOk`,
      );
    }
  });
});
