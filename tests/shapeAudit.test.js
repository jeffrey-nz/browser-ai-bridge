import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditShapes,
  bandStats,
  exclusionStats,
  classifyAbsence,
  formatOutOfRangeSection,
  formatWrongBucketSection,
  computeStandardizedRates,
  fisherExactTwoSided,
} from "../scripts/shape-audit.mjs";

/**
 * T-027: `shape` stored in a run json is whatever classify() said at write
 * time and is never backfilled when the classifier is later corrected — so
 * it can silently disagree with what HEAD's own classify() says about the
 * same `raw` right now. auditShapes() is the comparison auditShapes.mjs's
 * live corpus report is built on; pinned here against synthetic rows rather
 * than the real corpus, which is expected to accumulate NEW disagreements
 * every time classify() is next corrected — that's drift this ticket's own
 * policy accepts, not something a test should treat as a regression.
 */

function writeCorpus(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(content), "utf8");
  }
}

test("auditShapes finds a row whose stored shape disagrees with a fresh classify()", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "stale.json": {
        truth: { count: 4, color: "teal" },
        results: [
          {
            providerId: "fake",
            // A real, structured PASS reply, but recorded with a stale
            // "WRONG" label — exactly T-012's COUNT_ONLY-filed-as-WRONG shape.
            raw: "SEES=yes COUNT=4 COLOR=teal",
            shape: "WRONG",
          },
        ],
      },
    });

    const { rowsWithRaw, disagreements, storedHistogram, recomputedHistogram } =
      auditShapes(dir);

    assert.equal(rowsWithRaw, 1);
    assert.equal(disagreements.length, 1);
    assert.deepEqual(disagreements[0], {
      file: "stale.json",
      providerId: "fake",
      storedShape: "WRONG",
      recomputedShape: "PASS",
    });
    assert.deepEqual(storedHistogram, { WRONG: 1 });
    assert.deepEqual(recomputedHistogram, { PASS: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auditShapes reports zero disagreements when stored shape already matches classify()", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "current.json": {
        truth: { count: 5, color: "crimson" },
        results: [{ providerId: "fake", raw: "SEES=no", shape: "SEES_NO" }],
      },
    });

    const { rowsWithRaw, disagreements } = auditShapes(dir);

    assert.equal(rowsWithRaw, 1);
    assert.equal(disagreements.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auditShapes buckets COUNT-right by truth.count (T-050 — a rate on the stimulus)", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "count4.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }, // right
          { providerId: "b", raw: "SEES=yes COUNT=4 COLOR=teal" }, // right
        ],
      },
      "count9.json": {
        truth: { count: 9, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" }, // wrong
          { providerId: "b", raw: "SEES=no" }, // not structured — excluded
        ],
      },
    });

    const { countStrata } = auditShapes(dir);

    assert.equal(countStrata[4].n, 2);
    assert.equal(countStrata[4].ok, 2);
    assert.deepEqual(countStrata[4].providers, new Set(["a", "b"]));
    assert.equal(countStrata[9].n, 1);
    assert.equal(countStrata[9].ok, 0);
    assert.deepEqual(countStrata[9].providers, new Set(["a"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-063: pooling COUNT-right across a 3-5/6-9 band comparison over whatever
// provider set happened to have rows in each band hid a 17-point effect in
// the reassuring direction on the real corpus — 3 of 9 providers had rows in
// only one band, and all three pushed the pooled gap smaller. providerBand
// (auditShapes' own per-provider-per-band tally) and bandStats() (the pooled/
// paired split) are pinned separately from countStrata's per-count numbers
// because the bug lived in a SECOND covariate (which providers were swept),
// not in the count bucketing itself.
test("auditShapes tallies providerBand (easy 3-5 / hard 6-9) per provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "count4.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" },
          { providerId: "b", raw: "SEES=yes COUNT=4 COLOR=teal" },
        ],
      },
      "count9.json": {
        truth: { count: 9, color: "teal" },
        results: [{ providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" }],
      },
    });

    const { providerBand } = auditShapes(dir);

    assert.deepEqual(providerBand, {
      a: { easy: { n: 1, ok: 1 }, hard: { n: 1, ok: 0 } },
      b: { easy: { n: 1, ok: 1 } },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bandStats: a provider with rows in only one band is named, not pooled into paired", () => {
  const providerBand = {
    a: { easy: { n: 10, ok: 10 }, hard: { n: 5, ok: 3 } }, // paired
    b: { easy: { n: 5, ok: 5 } }, // easy-only — inflates pooled easy
    c: { hard: { n: 5, ok: 5 } }, // hard-only — inflates pooled hard
  };

  const { pooled, paired, pairedCount, unpaired } = bandStats(providerBand);

  // Pooled mixes all three, same as the old behaviour.
  assert.deepEqual(pooled, { easy: { n: 15, ok: 15 }, hard: { n: 10, ok: 8 } });
  // Paired is provider `a` alone.
  assert.deepEqual(paired, { easy: { n: 10, ok: 10 }, hard: { n: 5, ok: 3 } });
  assert.equal(pairedCount, 1);
  assert.deepEqual(unpaired, [
    { providerId: "b", band: "easy" },
    { providerId: "c", band: "hard" },
  ]);
});

test("bandStats: every provider paired means no unpaired entries", () => {
  const providerBand = {
    a: { easy: { n: 3, ok: 3 }, hard: { n: 3, ok: 3 } },
    b: { easy: { n: 2, ok: 1 }, hard: { n: 2, ok: 2 } },
  };

  const { pairedCount, unpaired } = bandStats(providerBand);

  assert.equal(pairedCount, 2);
  assert.deepEqual(unpaired, []);
});

// T-088: a blind file (vision-probe.mjs --blind) carries no `truth` at
// all — nothing was drawn or sent. Before this fix, auditShapes called
// classify(r.raw, j.truth) unconditionally, which THROWS on a structured
// reply when truth is undefined (confirmed live before writing this fix).
// It never fired because 0 of every blind turn recorded so far states a
// count (T-072), but that is a fact about the corpus, not a guarantee —
// this pins the fix at the unit level, independent of what's on disk.
test("auditShapes does not crash on a blind file whose reply happens to be structured", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "blind-hypothetical.json": {
        blind: true,
        results: [
          {
            providerId: "fake",
            raw: "SEES=yes COUNT=5 COLOR=crimson", // never observed live, but must not crash
          },
        ],
      },
    });

    assert.doesNotThrow(() => auditShapes(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-088 clause 3: wrongRows must be gated the SAME way every other
// truth-dependent table in this file is — a blind row has no truth for
// colorOk to mean anything against, so a structured-but-blind reply must
// not enter the WRONG-bucket population even though (with the crash fixed
// above) classify() now returns a WRONG shape for it.
test("auditShapes excludes a blind row's structured-but-WRONG reply from wrongRows", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "blind-hypothetical.json": {
        blind: true,
        results: [
          { providerId: "fake", raw: "SEES=yes COUNT=5 COLOR=crimson" },
        ],
      },
      "sighted-wrong.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "real", raw: "SEES=yes COUNT=6 COLOR=teal" }, // genuinely WRONG, sighted
        ],
      },
    });

    const { wrongRows } = auditShapes(dir);

    assert.equal(wrongRows.length, 1);
    assert.equal(wrongRows[0].file, "sighted-wrong.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-088: rowsWithRaw counts everything (blind and sighted); every
// truth-gated table runs on sighted rows only. blindRowsWithRaw is the
// number that lets a reader get from one population to the other by
// reading, not subtracting.
test("auditShapes tallies blindRowsWithRaw separately from rowsWithRaw", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "blind.json": {
        blind: true,
        results: [
          { providerId: "a", raw: "SEES=no" },
          { providerId: "b", raw: "SEES=no" },
        ],
      },
      "sighted.json": {
        truth: { count: 4, color: "teal" },
        results: [{ providerId: "c", raw: "SEES=yes COUNT=4 COLOR=teal" }],
      },
    });

    const { rowsWithRaw, blindRowsWithRaw } = auditShapes(dir);

    assert.equal(rowsWithRaw, 3);
    assert.equal(blindRowsWithRaw, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-088: the histogram is a SHAPE tally and blind rows keep a real shape
// (SEES_NO here) — they belong in it. Only the truth-gated tables exclude
// them. This pins that a blind SEES_NO still lands in storedHistogram/
// recomputedHistogram, so a future "fix" that filters the histogram by
// truth presence would be caught here.
test("auditShapes still counts a blind row's shape in the histogram", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "blind.json": {
        blind: true,
        results: [{ providerId: "a", raw: "SEES=no", shape: "SEES_NO" }],
      },
    });

    const { storedHistogram, recomputedHistogram } = auditShapes(dir);

    assert.equal(storedHistogram.SEES_NO, 1);
    assert.equal(recomputedHistogram.SEES_NO, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auditShapes skips rows with no raw (ERROR shapes, pre-field runs)", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "errored.json": {
        truth: { count: 3, color: "indigo" },
        results: [{ providerId: "fake", shape: "ERROR", detail: "timeout" }],
      },
    });

    const { rowsWithRaw, disagreements } = auditShapes(dir);

    assert.equal(rowsWithRaw, 0);
    assert.equal(disagreements.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-065: the by-count exclusion spread T-063 clause 4 found (46.4 points)
// is the provider-mix covariate again, not a count effect — by band it is
// 2.6 points, by provider it is the full 0-100% range. exclusionByProviderBand
// is the source both the band and provider tables are built from, gated the
// SAME way shapeByCount is (raw + truth.count present) — deliberately not
// gated on countOk, because an excluded row never gets one and would be
// invisible to this table if it were.
test("auditShapes tallies exclusionByProviderBand (excluded shapes count too, unlike providerBand)", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "count4.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }, // structured
          { providerId: "b", raw: "SEES=no" }, // excluded (SEES_NO)
        ],
      },
      "count9.json": {
        truth: { count: 9, color: "teal" },
        results: [{ providerId: "a", raw: "SEES=no" }], // excluded (SEES_NO)
      },
    });

    const { exclusionByProviderBand } = auditShapes(dir);

    assert.deepEqual(exclusionByProviderBand, {
      a: {
        easy: { total: 1, excluded: 0 },
        hard: { total: 1, excluded: 1 },
      },
      b: { easy: { total: 1, excluded: 1 } },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exclusionStats: bands, providers and fully-excluded providers", () => {
  const exclusionByProviderBand = {
    a: { easy: { total: 10, excluded: 2 }, hard: { total: 5, excluded: 1 } },
    b: { easy: { total: 3, excluded: 3 } }, // fully excluded, easy-only
    c: { hard: { total: 4, excluded: 0 } }, // fully SURVIVING, hard-only
  };

  const { byBand, byProvider, fullyExcluded } = exclusionStats(
    exclusionByProviderBand,
  );

  assert.deepEqual(byBand, {
    easy: { total: 13, excluded: 5 },
    hard: { total: 9, excluded: 1 },
  });
  assert.deepEqual(byProvider, {
    a: { total: 15, excluded: 3 },
    b: { total: 3, excluded: 3 },
    c: { total: 4, excluded: 0 },
  });
  assert.deepEqual(fullyExcluded, ["b"]);
});

test("classifyAbsence: no rows is genuinely absent, rows all excluded is not", () => {
  const exclusionByProviderBand = {
    deepseek: { hard: { total: 1, excluded: 1 } },
    perplexity: {},
  };

  assert.deepEqual(
    classifyAbsence(exclusionByProviderBand, "deepseek", "hard"),
    { kind: "all-excluded", total: 1, excluded: 1 },
  );
  assert.deepEqual(
    classifyAbsence(exclusionByProviderBand, "perplexity", "easy"),
    { kind: "absent", total: 0, excluded: 0 },
  );
  assert.deepEqual(
    classifyAbsence(exclusionByProviderBand, "unknown-provider", "easy"),
    { kind: "absent", total: 0, excluded: 0 },
  );
});

test("classifyAbsence: some excluded, some not, is mixed", () => {
  const exclusionByProviderBand = {
    a: { easy: { total: 3, excluded: 1 } },
  };

  assert.deepEqual(classifyAbsence(exclusionByProviderBand, "a", "easy"), {
    kind: "mixed",
    total: 3,
    excluded: 1,
  });
});

// T-084 clause 5: a per-provider rate is only comparable to another's if
// the stimulus sets are comparable — providerStrata tracks the SET of
// truth.count values each provider was ever graded against, same gate
// countStrata/providerBand use, so a provider shown 7 of 7 counts isn't
// silently ranked against one shown 1 of 7.
test("auditShapes tallies providerStrata (which counts each provider was shown)", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "count4.json": {
        truth: { count: 4, color: "teal" },
        results: [{ providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }],
      },
      "count9.json": {
        truth: { count: 9, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" },
          { providerId: "b", raw: "SEES=no" }, // not structured — excluded
        ],
      },
    });

    const { providerStrata } = auditShapes(dir);

    assert.equal(providerStrata.a.n, 2);
    assert.equal(providerStrata.a.ok, 1);
    assert.deepEqual(providerStrata.a.countsShown, new Set([4, 9]));
    assert.equal(providerStrata.b, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-091: the headline's sighted/blind split (`j.blind`) and every
// truth-gated table's own gate (`isGradable`, i.e. `j.truth?.count !==
// undefined`) are two DIFFERENT predicates that happen to agree on every
// row recorded so far. Nothing enforces that agreement — a sighted file
// with no gradable truth (a stimulus that failed to generate, an aborted
// --pin run) would make the headline's "N sighted" and the tables'
// denominator (N-1) disagree, silently. sightedNoTruthRows/
// blindWithTruthRows are the visible record of exactly that mismatch.
test("auditShapes flags a sighted row with no gradable truth, and a blind row that unexpectedly carries one", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      // Sighted (not blind), but no truth.count at all — the mismatch
      // clause 2 exists to surface. raw is a STRUCTURED reply (T-101: this
      // used to have to be "SEES=no" instead, because classify()'s
      // structured branch threw on a truly absent truth before that
      // ticket fixed it at the source — a structured raw here is now the
      // actual proof this row can reach sightedNoTruthRows at all, not
      // just a row that happens not to trigger the crash).
      "sighted-no-truth.json": {
        results: [{ providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }],
      },
      // Blind, but carries a truth.count anyway — the other direction of
      // the same mismatch.
      "blind-with-truth.json": {
        blind: true,
        truth: { count: 5, color: "teal" },
        results: [{ providerId: "b", raw: "SEES=no" }],
      },
      // A normal sighted row — present in neither mismatch list.
      "normal.json": {
        truth: { count: 6, color: "teal" },
        results: [{ providerId: "c", raw: "SEES=yes COUNT=6 COLOR=teal" }],
      },
    });

    const { sightedNoTruthRows, blindWithTruthRows } = auditShapes(dir);

    assert.equal(sightedNoTruthRows.length, 1);
    assert.equal(sightedNoTruthRows[0].file, "sighted-no-truth.json");
    assert.equal(sightedNoTruthRows[0].providerId, "a");

    assert.equal(blindWithTruthRows.length, 1);
    assert.equal(blindWithTruthRows[0].file, "blind-with-truth.json");
    assert.equal(blindWithTruthRows[0].providerId, "b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-101 review: a blind row is ungradable BY CONSTRUCTION — no picture was
// shown, so there is nothing a structured reply could correctly describe,
// however closely a corrupt record's `truth` field happens to match it.
// The isBlindFile ternary at the classify() call site is the statement of
// that rule, not scaffolding around classify()'s old crash — grading a
// blind row against whatever truth it happens to carry would manufacture a
// PASS out of a picture that was never shown, exactly the shape
// blindWithTruthRows (above) exists to catch, one level further in.
test("a blind row that carries a truth is graded ungradable, not PASS, even when its structured reply matches that truth", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "blind-with-matching-truth.json": {
        blind: true,
        truth: { count: 5, color: "teal" },
        results: [{ providerId: "b", raw: "SEES=yes COUNT=5 COLOR=teal" }],
      },
    });

    const { recomputedHistogram, wrongRows, blindWithTruthRows } =
      auditShapes(dir);

    // Not PASS: a blind row must never be gradable, whatever truth a
    // corrupt record happens to carry.
    assert.equal(recomputedHistogram.PASS, undefined);
    assert.equal(recomputedHistogram.WRONG, 1);
    assert.equal(wrongRows.length, 1);
    assert.equal(wrongRows[0].colorOk, false);
    // And the mismatch is still visible on its own terms (T-091).
    assert.equal(blindWithTruthRows.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-096: the test above pins the fault this ticket is about at the DATA
// level — provider "b" answers only SEES=no and is entirely absent from
// providerStrata (the GRADED population), which is exactly what let it
// disappear from a block captioned as a per-provider ranking. providerSighted
// is the fix: every row with a truth to grade against counts, refusal or
// not, so a provider that only refuses still has a row (n=1, ok=0), not no
// row at all.
test("auditShapes tallies providerSighted (every sighted row, refusals included) even for a provider absent from providerStrata", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "count4.json": {
        truth: { count: 4, color: "teal" },
        results: [{ providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }],
      },
      "count9.json": {
        truth: { count: 9, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" },
          { providerId: "b", raw: "SEES=no" }, // refuses every turn
        ],
      },
    });

    const { providerStrata, providerSighted } = auditShapes(dir);

    // The fault, still true of the GRADED population: b is absent.
    assert.equal(providerStrata.b, undefined);
    // The fix: b is present in the SIGHTED population, scored as wrong
    // rather than omitted — a provider cannot raise its own rate by
    // refusing, since refusing no longer removes the row from view.
    assert.equal(providerSighted.b.n, 1);
    assert.equal(providerSighted.b.ok, 0);
    assert.deepEqual(providerSighted.b.countsShown, new Set([9]));
    // a is graded on both turns and sighted on both — the two populations
    // agree exactly where a provider never refuses.
    assert.equal(providerSighted.a.n, 2);
    assert.equal(providerSighted.a.ok, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-096 clause 4: EXCLUDED_SHAPES pools SEES_NO/ECHO/NO_ANSWER under one
// "excluded" tally. providerExcludedByShape keeps the three apart per
// provider, so an ECHO (bridge/extraction failure) is never read as a
// SEES_NO (the only shape with a transport-failure argument behind it).
test("auditShapes splits providerExcludedByShape by shape, not one pooled tally", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "seesno.json": {
        truth: { count: 4, color: "teal" },
        results: [{ providerId: "a", raw: "SEES=no" }],
      },
      "echo.json": {
        truth: { count: 5, color: "teal" },
        results: [
          {
            providerId: "a",
            raw: "Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, no other text: SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest match>",
          },
        ],
      },
      "noanswer.json": {
        truth: { count: 6, color: "teal" },
        results: [{ providerId: "a", raw: "" }],
      },
    });

    const { providerExcludedByShape } = auditShapes(dir);

    assert.deepEqual(providerExcludedByShape.a, {
      SEES_NO: 1,
      ECHO: 1,
      NO_ANSWER: 1,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-096 clause 5: providerSightedCells/countStrataSighted must feed
// computeStandardizedRates() the same way providerCountCells/countStrata
// already do for the GRADED rate — same function, same contract, so the
// END-TO-END rate is standardised by the identical convention rather than
// left crude beside a standardised graded column.
test("providerSightedCells standardises through the same computeStandardizedRates() the graded rate uses", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "p1.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" },
          { providerId: "b", raw: "SEES=no" },
        ],
      },
      "p2.json": {
        truth: { count: 9, color: "teal" },
        results: [{ providerId: "a", raw: "SEES=yes COUNT=9 COLOR=teal" }],
      },
    });

    const { providerSightedCells, countStrataSighted } = auditShapes(dir);
    const result = computeStandardizedRates(
      providerSightedCells,
      countStrataSighted,
    );

    // a: right on both its sighted rows, at counts 4 and 9 (full coverage).
    assert.equal(result.a.crude, 1);
    assert.equal(result.a.standardized, 1);
    assert.equal(result.a.weightCovered, 1);
    // b: sighted once (a refusal, counted wrong), only at count 4.
    assert.equal(result.b.n, 1);
    assert.equal(result.b.ok, 0);
    assert.equal(result.b.crude, 0);
    assert.equal(result.b.standardized, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-084 clause 4: wrongRows carries colorOk for every WRONG-shaped row, so
// "8 of 9 wrong rows named the colour correctly" is computed off the same
// pass classify() already made, not re-derived by a reader.
test("auditShapes collects wrongRows with colorOk, only for WRONG-shaped rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "wrong-color-right.json": {
        truth: { count: 9, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" }, // WRONG, colour right
        ],
      },
      "wrong-color-wrong.json": {
        truth: { count: 5, color: "indigo" },
        results: [
          { providerId: "b", raw: "SEES=yes COUNT=1 COLOR=goldenrod" }, // WRONG, colour wrong
        ],
      },
      "pass.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "c", raw: "SEES=yes COUNT=4 COLOR=teal" }, // PASS — not WRONG
        ],
      },
    });

    const { wrongRows } = auditShapes(dir);

    assert.equal(wrongRows.length, 2);
    const right = wrongRows.find((r) => r.file === "wrong-color-right.json");
    const wrong = wrongRows.find((r) => r.file === "wrong-color-wrong.json");
    assert.equal(right.colorOk, true);
    assert.equal(wrong.colorOk, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatWrongBucketSection: reports colour-right rate among WRONG rows", () => {
  const wrongRows = [
    { file: "a.json", providerId: "x", colorOk: true },
    { file: "b.json", providerId: "y", colorOk: true },
    { file: "c.json", providerId: "z", colorOk: false },
  ];
  const lines = formatWrongBucketSection(wrongRows);
  const joined = lines.join("\n");
  assert.match(joined, /WRONG rows: 3/);
  assert.match(joined, /colour named correctly among them: 2\/3/);
  assert.match(joined, /66\.7%/);
});

test("formatWrongBucketSection: zero WRONG rows prints 0 of 0, not a division-by-zero artefact", () => {
  const lines = formatWrongBucketSection([]);
  const joined = lines.join("\n");
  assert.match(joined, /WRONG rows: 0/);
  assert.match(joined, /colour named correctly among them: 0\/0/);
  assert.doesNotMatch(joined, /NaN/);
});

// T-076: an out-of-range WRONG count names a picture the generator could
// never have drawn. auditShapes collects these (outOfRangeRows) straight
// from classify()'s own outOfRange field, split by onBoundary (said
// MAX+1 at truth MAX — a miscount) vs not (cannot be a miscount).
test("auditShapes collects outOfRangeRows, split by onBoundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "boundary.json": {
        truth: { count: 9, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" }, // boundary
        ],
      },
      "floor.json": {
        truth: { count: 5, color: "teal" },
        results: [
          { providerId: "b", raw: "SEES=yes COUNT=1 COLOR=teal" }, // not boundary
        ],
      },
      "inrange.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "c", raw: "SEES=yes COUNT=5 COLOR=teal" }, // WRONG, in range
        ],
      },
    });

    const { outOfRangeRows } = auditShapes(dir);

    assert.equal(outOfRangeRows.length, 2);
    const boundary = outOfRangeRows.find((r) => r.file === "boundary.json");
    const floor = outOfRangeRows.find((r) => r.file === "floor.json");
    assert.equal(boundary.said, 10);
    assert.equal(boundary.truth, 9);
    assert.equal(boundary.onBoundary, true);
    assert.equal(floor.said, 1);
    assert.equal(floor.truth, 5);
    assert.equal(floor.onBoundary, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-078: structuredCount is the denominator the zero-tally line needs — the
// same structured-reply population outOfRangeRows is drawn from (a row that
// carried a countOk verdict at all: PASS/COUNT_ONLY/WRONG), not every row on
// disk. A SEES_NO row here must not inflate it.
test("auditShapes counts structuredCount — the structured-reply population, not every row", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "mixed.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }, // structured
          { providerId: "b", raw: "SEES=yes COUNT=10 COLOR=teal" }, // structured (out of range)
          { providerId: "c", raw: "SEES=no" }, // NOT structured — excluded
        ],
      },
    });

    const { structuredCount, outOfRangeRows } = auditShapes(dir);

    assert.equal(structuredCount, 2);
    assert.equal(outOfRangeRows.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-078: this section could previously only print the caveat about what a
// zero means from INSIDE `if (outOfRangeRows.length > 0)` — the one reader
// who most needs "0 here is not evidence nobody fabricated, only that
// nobody fabricated conspicuously" (someone seeing a clean audit) was
// guaranteed never to see it. This is the test that pins the fix: the zero
// case must still produce the caveat, stating a real denominator so "0 of
// 65" and "0 of 0" read as the different facts they are.
test("formatOutOfRangeSection: zero tally still prints the caveat, with the real denominator", () => {
  const lines = formatOutOfRangeSection([], 65, 3, 9);
  const joined = lines.join("\n");
  assert.match(joined, /0 of 65 structured repl(y|ies) examined/);
  assert.match(joined, /NOTE: this check is one-directional/);
  assert.match(
    joined,
    /A total of 0 here is not evidence nobody fabricated, only that/,
  );
});

test("formatOutOfRangeSection: zero of zero is not read as reassuring as zero of many", () => {
  const lines = formatOutOfRangeSection([], 0, 3, 9);
  const joined = lines.join("\n");
  assert.match(joined, /0 of 0 structured repl(y|ies) examined/);
});

// T-078 clause 3: the non-zero branch must stay byte-for-byte what T-076
// shipped — same strings, same order — since a live diff against the real
// corpus (evidence/t078-realcorpus-output.txt, if committed) depends on it.
test("formatOutOfRangeSection: non-zero tally format is unchanged from T-076", () => {
  const outOfRangeRows = [
    {
      file: "boundary.json",
      providerId: "a",
      truth: 9,
      said: 10,
      imageAttached: true,
      onBoundary: true,
    },
    {
      file: "floor.json",
      providerId: "b",
      truth: 5,
      said: 1,
      imageAttached: true,
      onBoundary: false,
    },
  ];
  const lines = formatOutOfRangeSection(outOfRangeRows, 999, 3, 9);
  assert.deepEqual(lines, [
    "\nOut-of-range COUNT (generator draws 3..9 only) — 2 rows:",
    "  boundary miscount (said 10 at truth 9, off by one): 1",
    "    boundary.json  a  truth=9 said=10  imageAttached=true",
    "  below the floor / not adjacent — cannot be a miscount: 1",
    "    floor.json  b  truth=5 said=1  gap=-4  imageAttached=true",
    "  NOTE: this check is one-directional — out of range proves the reply\n" +
      "  is not a reading of any drawable picture; IN range proves nothing.\n" +
      "  A total of 0 here is not evidence nobody fabricated, only that\n" +
      "  nobody fabricated conspicuously.",
  ]);
});

// T-092: providerCountCells is the cross-tab shape-audit had never
// printed — one cell per (provider, truth.count), independent of
// providerStrata's own summed n/ok.
test("auditShapes tallies providerCountCells per (provider, truth.count) cell", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      "count4.json": {
        truth: { count: 4, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=4 COLOR=teal" }, // right
        ],
      },
      "count9.json": {
        truth: { count: 9, color: "teal" },
        results: [
          { providerId: "a", raw: "SEES=yes COUNT=10 COLOR=teal" }, // wrong
        ],
      },
    });

    const { providerCountCells } = auditShapes(dir);

    assert.deepEqual(providerCountCells.a.get(4), { n: 1, ok: 1 });
    assert.deepEqual(providerCountCells.a.get(9), { n: 1, ok: 0 });
    assert.equal(providerCountCells.a.has(5), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T-092: pinned against the board's own worked example (T-084/T-092's
// goal section) so the formula is checked against a real, hand-verified
// reading, not just internal consistency — mistral 4/7 crude (57.1%)
// standardises to 80.6% at 83.8% corpus weight covered, over strata
// [4,5,7,9] against a corpus mix of {3:6,4:16,5:23,6:4,7:11,8:2,9:12}.
test.describe("computeStandardizedRates", () => {
  test("reproduces the board's own worked mistral example", () => {
    const countStrata = {
      3: { n: 6 },
      4: { n: 16 },
      5: { n: 23 },
      6: { n: 4 },
      7: { n: 11 },
      8: { n: 2 },
      9: { n: 12 },
    };
    const providerCountCells = {
      mistral: new Map([
        [4, { n: 2, ok: 2 }],
        [5, { n: 1, ok: 1 }],
        [7, { n: 1, ok: 1 }],
        [9, { n: 3, ok: 0 }],
      ]),
    };
    const result = computeStandardizedRates(providerCountCells, countStrata);
    assert.equal(result.mistral.crude, 4 / 7);
    assert.ok(Math.abs(result.mistral.standardized - 0.806) < 0.001);
    assert.ok(Math.abs(result.mistral.weightCovered - 0.838) < 0.001);
    assert.deepEqual(result.mistral.strataHeld, [4, 5, 7, 9]);
  });

  test("a provider covering every stratum: standardised equals crude", () => {
    const countStrata = { 3: { n: 2 }, 4: { n: 2 } };
    const providerCountCells = {
      gemini: new Map([
        [3, { n: 2, ok: 2 }],
        [4, { n: 2, ok: 2 }],
      ]),
    };
    const result = computeStandardizedRates(providerCountCells, countStrata);
    assert.equal(result.gemini.crude, 1);
    assert.equal(result.gemini.standardized, 1);
    assert.equal(result.gemini.weightCovered, 1);
  });

  test("a provider covering NO strata that exist in countStrata: weightCovered 0", () => {
    // Defensive case — should not happen in practice (a provider's cell
    // count always contributes to countStrata too), but the function
    // must not divide by zero if it ever does.
    const countStrata = { 3: { n: 2 } };
    const providerCountCells = { ghost: new Map() };
    const result = computeStandardizedRates(providerCountCells, countStrata);
    assert.equal(result.ghost.weightCovered, 0);
    assert.equal(result.ghost.standardized, null);
  });
});

// T-092: fisherExactTwoSided pinned against a PUBLISHED value (Fisher's
// own "lady tasting tea" 2x2, the textbook example: 3 right + 1 wrong vs
// 1 right + 3 wrong out of 4 each way, two-sided p = 0.4857) before
// trusting it on anything this file reports — a home-grown stats
// function with no external check is exactly the kind of "true sentence
// nobody verified" this board's own lessons warn about.
test.describe("fisherExactTwoSided", () => {
  test("reproduces the published 'lady tasting tea' p-value", () => {
    const p = fisherExactTwoSided(3, 1, 1, 3);
    assert.ok(Math.abs(p - 0.4857) < 0.001, `got ${p}`);
  });

  test("perfect separation (6,0 / 0,6): p is small and matches hand computation", () => {
    // p(6) = C(6,6)*C(6,0)/C(12,6) = 1/924; two-sided doubles the
    // symmetric tail exactly for this table.
    const p = fisherExactTwoSided(6, 0, 0, 6);
    assert.ok(Math.abs(p - 2 / 924) < 1e-6, `got ${p}`);
  });

  test("identical rates in both groups: p is 1 (no evidence of association)", () => {
    const p = fisherExactTwoSided(3, 3, 3, 3);
    assert.ok(Math.abs(p - 1) < 1e-9, `got ${p}`);
  });

  test("symmetric under swapping rows", () => {
    const p1 = fisherExactTwoSided(6, 0, 0, 6);
    const p2 = fisherExactTwoSided(0, 6, 6, 0); // rows swapped
    assert.ok(Math.abs(p1 - p2) < 1e-9);
  });
});

// T-106 clause 3: a deliberate evidence-break plant (vision-probe.mjs
// --planted-break, the file-level `plantedBreak` field ia-grade.mjs already
// partitions on) proves the imageAttached flag CAN be wrong under a broken
// evidence check — it is not a naturally-occurring reading of the provider
// it was performed on, and a RIGHT plant would otherwise inflate that
// provider in a ranking. This corpus had FOUR such rows and the ranking
// (providerStrataNoPlant/providerCountCellsNoPlant/countStrataNoPlant and
// providerSightedNoPlant/providerSightedCellsNoPlant/countStrataSightedNoPlant)
// must exclude them while the plant-including originals (providerStrata,
// providerSighted, etc. — used by the per-truth.count table and cross-tab,
// a different question, clause 7) keep counting them exactly as before.
test("auditShapes excludes a planted row from the ranking populations but keeps counting it in the original ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "shape-audit-test-"));
  try {
    writeCorpus(dir, {
      // A deliberate plant, a RIGHT answer — the exact shape that inflates
      // a provider if left in a ranking.
      "planted.json": {
        plantedBreak: "test plant",
        truth: { count: 5, color: "teal" },
        results: [
          {
            providerId: "a",
            raw: "SEES=yes COUNT=5 COLOR=teal",
            imageAttached: false,
          },
        ],
      },
      // A natural row from the SAME provider, also right — so the
      // provider still appears in the ranking, just without the plant's
      // own contribution.
      "natural.json": {
        truth: { count: 6, color: "teal" },
        results: [
          {
            providerId: "a",
            raw: "SEES=yes COUNT=6 COLOR=teal",
            imageAttached: true,
          },
        ],
      },
    });

    const {
      plantedRowCount,
      providerSighted,
      providerSightedNoPlant,
      providerStrata,
      providerStrataNoPlant,
    } = auditShapes(dir);

    assert.equal(plantedRowCount, 1);

    // Original (plant-including) populations: both rows counted.
    assert.equal(providerSighted.a.n, 2);
    assert.equal(providerSighted.a.ok, 2);
    assert.equal(providerStrata.a.n, 2);
    assert.equal(providerStrata.a.ok, 2);

    // Ranking (plant-excluding) populations: only the natural row.
    assert.equal(providerSightedNoPlant.a.n, 1);
    assert.equal(providerSightedNoPlant.a.ok, 1);
    assert.equal(providerStrataNoPlant.a.n, 1);
    assert.equal(providerStrataNoPlant.a.ok, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
