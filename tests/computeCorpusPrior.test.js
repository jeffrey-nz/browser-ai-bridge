import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCorpusPrior,
  INDEPENDENCE_MIN_IMAGE_SHARE,
} from "../scripts/ia-grade.mjs";

// T-087: KEY_SPACE (vision-probe.mjs) is a fact about the GENERATOR's draw;
// this is the corpus's own REALISED prior — the modal (count,color) cell,
// tallied once per file and once per reply row, with its own independence
// check (distinct images cited at that cell) so a concentrated prior backed
// by one recycled fixture cannot be mistaken for a concentrated draw.
test.describe("computeCorpusPrior", () => {
  test("no entries: no modal cell, both rates null", () => {
    const p = computeCorpusPrior([]);
    assert.equal(p.modalCell, null);
    assert.equal(p.totalFiles, 0);
    assert.equal(p.totalRows, 0);
    assert.equal(p.fileRate, null);
    assert.equal(p.rowRate, null);
  });

  test("finds the modal cell by FILE count, not row count", () => {
    // 5/crimson: 3 files, 1 row each (3 rows). 7/teal: 2 files, 5 rows each
    // (10 rows) — more ROWS, but fewer FILES. The modal cell must come out
    // 5/crimson: file count decides it, not the row total.
    const p = computeCorpusPrior([
      { count: 5, color: "crimson", rowCount: 1, imagePath: "a.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "b.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "c.png" },
      { count: 7, color: "teal", rowCount: 5, imagePath: "d.png" },
      { count: 7, color: "teal", rowCount: 5, imagePath: "e.png" },
    ]);
    assert.equal(p.modalCell, "5/crimson");
    assert.equal(p.modalFileCount, 3);
    assert.equal(p.modalRowCount, 3);
    assert.equal(p.totalFiles, 5);
    assert.equal(p.totalRows, 13);
    assert.equal(p.visitedCells, 2);
  });

  test("independence check: counts DISTINCT images at the modal cell, not file count", () => {
    // Same image cited 3 times at the modal cell — the independence check
    // must read 1, not 3, or a single recycled fixture would masquerade as
    // three independent draws landing on the same cell. 1 of 3 files is
    // also below INDEPENDENCE_MIN_IMAGE_SHARE, so this cell fails its own
    // independence check too.
    const p = computeCorpusPrior([
      { count: 5, color: "crimson", rowCount: 1, imagePath: "same.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "same.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "same.png" },
      { count: 6, color: "indigo", rowCount: 1, imagePath: "other.png" },
    ]);
    assert.equal(p.modalCell, "5/crimson");
    assert.equal(p.modalFileCount, 3);
    assert.equal(p.modalImages, 1);
    assert.equal(p.distinctImages, 2);
    assert.equal(p.independentEnough, false);
  });

  // T-087 review: a caveat printed BELOW the realised-prior number is not
  // enough — the PM's own example is "22 files over 2 distinct images",
  // where one recycled fixture could be doing almost all the work. The
  // function must be able to say the prior should be WITHDRAWN, not just
  // report a low count beside it.
  test("independentEnough is false when the modal cell rests on too few distinct images (22 over 2)", () => {
    const entries = [];
    // 2 distinct images, 11 files each — matches the PM's own example.
    for (let i = 0; i < 22; i++) {
      entries.push({
        count: 5,
        color: "crimson",
        rowCount: 1,
        imagePath: i % 2 === 0 ? "recycled-a.png" : "recycled-b.png",
      });
    }
    const p = computeCorpusPrior(entries);
    assert.equal(p.modalCell, "5/crimson");
    assert.equal(p.modalFileCount, 22);
    assert.equal(p.modalImages, 2);
    assert.equal(p.independentEnough, false);
  });

  test("independentEnough is true when at least the threshold share of files are distinct images", () => {
    // 4 files, 2 distinct images — exactly INDEPENDENCE_MIN_IMAGE_SHARE
    // (0.5) if the threshold is 0.5; asserted against the exported
    // constant rather than the literal, so this test tracks the code if
    // the threshold ever changes.
    const entries = [
      { count: 5, color: "crimson", rowCount: 1, imagePath: "a.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "a.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "b.png" },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "b.png" },
    ];
    const p = computeCorpusPrior(entries);
    assert.equal(p.modalImages, 2);
    assert.equal(p.modalFileCount, 4);
    assert.equal(
      p.modalImages >= p.modalFileCount * INDEPENDENCE_MIN_IMAGE_SHARE,
      true,
    );
    assert.equal(p.independentEnough, true);
  });

  test("independenceThreshold on the result matches the exported constant, never drifts", () => {
    const p = computeCorpusPrior([
      { count: 5, color: "crimson", rowCount: 1, imagePath: "a.png" },
    ]);
    assert.equal(p.independenceThreshold, INDEPENDENCE_MIN_IMAGE_SHARE);
  });

  test("no modal cell (empty entries): independentEnough is false, not undefined", () => {
    const p = computeCorpusPrior([]);
    assert.equal(p.independentEnough, false);
  });

  test("a missing imagePath does not count toward distinctImages or the independence check", () => {
    const p = computeCorpusPrior([
      { count: 5, color: "crimson", rowCount: 1, imagePath: null },
      { count: 5, color: "crimson", rowCount: 1, imagePath: "a.png" },
    ]);
    assert.equal(p.modalFileCount, 2);
    assert.equal(p.modalImages, 1);
    assert.equal(p.distinctImages, 1);
  });

  test("fileRate and rowRate are the modal cell's share of the total", () => {
    const p = computeCorpusPrior([
      { count: 5, color: "crimson", rowCount: 3, imagePath: "a.png" },
      { count: 6, color: "indigo", rowCount: 1, imagePath: "b.png" },
    ]);
    assert.equal(p.fileRate, 1 / 2);
    assert.equal(p.rowRate, 3 / 4);
  });
});
