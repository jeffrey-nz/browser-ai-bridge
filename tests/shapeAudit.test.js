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
