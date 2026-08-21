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
