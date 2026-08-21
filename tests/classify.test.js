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
