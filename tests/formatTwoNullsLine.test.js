import test from "node:test";
import assert from "node:assert/strict";
import { formatTwoNullsLine } from "../scripts/ia-grade.mjs";

// T-087 review, second round: formatCorpusPriorBlock withdrew the
// realised-prior NUMBER when independentEnough is false, but the very next
// consumer of `prior` — this sentence — kept computing its own multiplier
// as `prior.rowRate / genRate`. rowRate is still a real, non-null number in
// the degenerate case (computeCorpusPrior never withdraws it, only the
// PRINTER decides whether to quote it), so the multiplier silently handed
// the reader back the exact rate the block above had just refused to
// publish — multiply the printed Nx by the generator's 1-in-28 and the
// withdrawn number falls straight out. These tests drive the degenerate
// case through THIS function specifically, not just through a flag on
// computeCorpusPrior's return, because the leak lived in the printer, not
// in the data.
test.describe("formatTwoNullsLine", () => {
  test("independentEnough=true: prices the INVENTING null at the corpus's realised prior", () => {
    const prior = {
      modalCell: "5/crimson",
      independentEnough: true,
      rowRate: 0.25, // 4x the generator's 1-in-28 (1/28 ≈ 0.0357)
    };
    const line = formatTwoNullsLine(prior, 12, 12, 7, 4);
    assert.match(line, /priced at the corpus's realised prior/);
    assert.match(line, /7\.0x higher/); // 0.25 / (1/28) = 7.0
  });

  // THE CASE THAT MATTERS: a withdrawn prior must leak NOTHING derivable
  // back into the withdrawn rate — no multiplier, no rowRate, no fragment
  // of arithmetic a reader could combine with 1-in-28 to reconstruct it.
  test("independentEnough=false: does NOT price the INVENTING null, and leaks no rate", () => {
    const prior = {
      modalCell: "5/crimson",
      independentEnough: false,
      // A real, non-null rowRate — exactly what a withdrawn prior still
      // carries internally. The withdrawn rate this would reconstruct is
      // 0.55 / (1/28) = 15.4x — that number must not appear anywhere.
      rowRate: 0.55,
    };
    const line = formatTwoNullsLine(prior, 12, 12, 7, 4);
    assert.doesNotMatch(line, /priced at the corpus's realised prior/);
    assert.doesNotMatch(line, /x higher/);
    assert.doesNotMatch(line, /15\.4/);
    assert.doesNotMatch(line, /0\.55/);
    assert.match(line, /cannot be priced from this corpus/);
    assert.match(line, /withdrawn/);
  });

  test("no modal cell at all: also cannot be priced, same as a failed independence check", () => {
    const prior = { modalCell: null, independentEnough: false, rowRate: null };
    const line = formatTwoNullsLine(prior, 12, 12, 7, 4);
    assert.match(line, /cannot be priced from this corpus/);
  });

  test("the blind-refusal half of the sentence is unaffected by independentEnough either way", () => {
    const priced = formatTwoNullsLine(
      { modalCell: "5/crimson", independentEnough: true, rowRate: 0.25 },
      9,
      10,
      7,
      4,
    );
    const withdrawn = formatTwoNullsLine(
      { modalCell: "5/crimson", independentEnough: false, rowRate: 0.55 },
      9,
      10,
      7,
      4,
    );
    assert.match(priced, /refusing 9 of 10 times/);
    assert.match(withdrawn, /refusing 9 of 10 times/);
  });
});
