import test from "node:test";
import assert from "node:assert/strict";
import { formatCorpusPriorBlock } from "../scripts/ia-grade.mjs";

// T-087 review: the realised-prior number must be WITHDRAWN, not printed
// with a caveat beside it, when the modal cell fails its own independence
// check — a caveat below a number does not stop the number being quoted.
test.describe("formatCorpusPriorBlock", () => {
  test("independentEnough=true: prints the realised rate and the passing independence check", () => {
    const prior = {
      modalCell: "5/crimson",
      independentEnough: true,
      modalRowCount: 41,
      totalRows: 176,
      modalFileCount: 25,
      totalFiles: 118,
      visitedCells: 27,
      distinctImages: 102,
      modalImages: 22,
      independenceThreshold: 0.5,
    };
    const joined = formatCorpusPriorBlock(prior, 7, 4).join("\n");
    assert.match(
      joined,
      /key space \(the GENERATOR\): COUNT 1-in-7 x COLOR 1-in-4 = 1-in-28/,
    );
    assert.match(
      joined,
      /modal cell 5\/crimson, 41 of 176 rows \(25 of 118 files\)/,
    );
    assert.match(joined, /passes/);
    assert.doesNotMatch(joined, /WITHDRAWN/);
  });

  // THE CASE THIS FUNCTION EXISTS FOR: the reviewer's own "22 over 2"
  // example. The rate (1-in-4.3-shaped) must not appear anywhere.
  test("independentEnough=false: WITHDRAWS the rate, prints only the reason and threshold", () => {
    const prior = {
      modalCell: "5/crimson",
      independentEnough: false,
      modalRowCount: 22,
      totalRows: 22,
      modalFileCount: 22,
      totalFiles: 22,
      visitedCells: 1,
      distinctImages: 2,
      modalImages: 2,
      independenceThreshold: 0.5,
    };
    const joined = formatCorpusPriorBlock(prior, 7, 4).join("\n");
    assert.match(joined, /WITHDRAWN/);
    assert.match(joined, /2 distinct image\(s\) across 22 files/);
    assert.match(joined, /needs >= 11/);
    // The rate a reader would compute from modalRowCount/totalRows (22/22 =
    // 1-in-1.0) must not be printed as a "realised ... rows) = 1-in-X"
    // figure — the generator's OWN "1-in-28" line above is fine and
    // expected, so the check is scoped to the realised-prior format shape,
    // not to the substring "1-in-" anywhere in the block.
    assert.doesNotMatch(joined, /rows \([\d ]+ of [\d ]+ files\) = 1-in-/);
  });

  test("no modal cell at all (empty corpus): says so plainly, no WITHDRAWN, no rate", () => {
    const prior = { modalCell: null, independentEnough: false };
    const joined = formatCorpusPriorBlock(prior, 7, 4).join("\n");
    assert.match(joined, /no files carry both truth and results/);
    assert.doesNotMatch(joined, /WITHDRAWN/);
    assert.doesNotMatch(joined, /rows \([\d ]+ of [\d ]+ files\) = 1-in-/);
  });
});
