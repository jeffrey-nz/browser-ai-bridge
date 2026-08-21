import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditShapes } from "../scripts/shape-audit.mjs";

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
