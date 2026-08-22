import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCorpusPrior,
  formatCorpusPriorBlock,
  formatTwoNullsLine,
} from "../scripts/ia-grade.mjs";

// T-087 review, second round: "one test covers the withdrawal reaching
// that sentence, not just the flag." This is that test — the reviewer's
// own synthetic corpus (22 files at 5/crimson over 2 distinct imagePaths,
// plus six files at other cells) run through the REAL computeCorpusPrior,
// then through BOTH printer functions that consume its result, asserting
// the withdrawn rate appears in neither joined output. Every other
// independence test in this repo asserts a field on computeCorpusPrior's
// return; none of them could have caught the review-round-2 leak, because
// it lived in a printer that read prior.rowRate directly instead of
// checking independentEnough first.
test("end-to-end: a corpus whose modal cell fails independence never has its rate quoted, by either consumer", () => {
  const entries = [];
  for (let i = 0; i < 22; i++) {
    entries.push({
      count: 5,
      color: "crimson",
      rowCount: 1,
      imagePath: i % 2 === 0 ? "recycled-a.png" : "recycled-b.png",
    });
  }
  // Six files at other cells, so the corpus isn't trivially all-one-cell —
  // matches the reviewer's own description of the synthetic input.
  const otherCells = [
    [3, "teal"],
    [4, "indigo"],
    [6, "goldenrod"],
    [7, "crimson"],
    [8, "teal"],
    [9, "indigo"],
  ];
  for (const [count, color] of otherCells) {
    entries.push({
      count,
      color,
      rowCount: 1,
      imagePath: `${count}-${color}.png`,
    });
  }

  const prior = computeCorpusPrior(entries);
  assert.equal(prior.modalCell, "5/crimson");
  assert.equal(prior.independentEnough, false);
  // The rate the withdrawal exists to stop: 22 rows of 28 total ≈ 0.786,
  // a ~22x multiplier over the generator's 1-in-28. If either consumer
  // below leaks it, the test fails on exactly that number.
  assert.ok(prior.rowRate > 0.7);

  const priorBlock = formatCorpusPriorBlock(prior, 7, 4).join("\n");
  const twoNullsLine = formatTwoNullsLine(prior, 12, 12, 7, 4);
  const everything = priorBlock + "\n" + twoNullsLine;

  assert.match(everything, /WITHDRAWN/);
  assert.match(everything, /cannot be priced from this corpus/);
  // No realised-prior rate anywhere (the generator's own fixed "1-in-28"
  // line is fine and expected — this checks the REALISED-prior format
  // shape specifically), no "Nx higher" multiplier, and no trace of the
  // rowRate value that would let a reader reconstruct the withdrawn rate.
  assert.doesNotMatch(everything, /rows \([\d ]+ of [\d ]+ files\) = 1-in-/);
  assert.doesNotMatch(everything, /x higher/);
  assert.doesNotMatch(everything, /0\.7\d+|22\.\d+x/);
});
