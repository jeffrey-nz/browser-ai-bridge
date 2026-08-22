import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { auditShapes, formatNoReplySection } from "../scripts/shape-audit.mjs";

/**
 * T-109: shape-audit's per-provider ranking line assembles a denominator,
 * a right-count and an exclusion breakdown from THREE separately-gated
 * populations (providerSightedNoPlant, providerStrataNoPlant,
 * providerExcludedByShapeNoPlant), each populated at its own site in the
 * row loop. At 97bf5b9 that produced a printed line whose own parts did
 * not add up (chatgpt: 5 right + 15 excluded against a denominator of 19 —
 * residual -1) and every gate was green: tests passed, prettier was clean,
 * the whole-output diff showed only the expected lines. T-106's redo fixed
 * THAT instance with a fixture-only test; this file generalises past it —
 * the SAME arithmetic relation, asserted over the real, committed corpus
 * (reports/vision-probe), for every provider key the ranking actually
 * prints, not provider `a` alone and not a fixture alone.
 *
 * These tests read the live corpus and their exact numbers will drift as
 * it grows — that is expected and is not the thing under test. What must
 * never drift is whether the relation holds, for whichever numbers are
 * there today.
 */

const CORPUS_DIR = path.join(process.cwd(), "reports", "vision-probe");

test("real corpus: the ranking's residual (sighted.n - graded.n - excluded) is 0 for every provider, and graded.ok equals sighted.ok wherever both exist", () => {
  const {
    providerSightedNoPlant,
    providerStrataNoPlant,
    providerExcludedByShapeNoPlant,
  } = auditShapes(CORPUS_DIR);

  const providers = Object.keys(providerSightedNoPlant).sort();
  assert.ok(
    providers.length > 0,
    "expected at least one provider in the real corpus — if this fails, the corpus moved or emptied and the test needs to be re-pointed, not the invariant weakened",
  );

  const report = [];
  for (const p of providers) {
    const sighted = providerSightedNoPlant[p];
    const graded = providerStrataNoPlant[p];
    const excl = providerExcludedByShapeNoPlant[p] || {
      SEES_NO: 0,
      ECHO: 0,
      NO_ANSWER: 0,
    };
    const gradedN = graded ? graded.n : 0;
    const exclTotal = excl.SEES_NO + excl.ECHO + excl.NO_ANSWER;
    // The relation clause 1 asks for, in full: the ranking's own
    // denominator (sighted.n) must equal its graded n plus its own
    // exclusion tally — AND the right-count printed in the "graded X%"
    // half must be the SAME right-count printed in the "end-to-end Y%"
    // half, since providerStrataNoPlant.ok and providerSightedNoPlant.ok
    // both increment under the identical `recomputed.countOk === true`
    // check (providerStrataNoPlant is the strict subset of
    // providerSightedNoPlant's rows where countOk is not undefined) — a
    // provider whose graded rate and end-to-end rate imply two DIFFERENT
    // right-counts would be printing two ranking columns that disagree
    // about how many times it was actually right.
    const residual = sighted.n - gradedN - exclTotal;
    const rightCountGap = graded ? graded.ok - sighted.ok : 0;
    report.push(
      `${p.padEnd(11)} residual=${residual}  right-count-gap=${rightCountGap}  (sighted ${sighted.n}/${sighted.ok}, graded ${graded ? `${gradedN}/${graded.ok}` : "never graded"}, excluded ${exclTotal})`,
    );
  }
  // Printed unconditionally (T-078's own rule elsewhere in this file: a
  // zero tally's meaning must stay reachable) — this IS the number clause
  // 1 asks to be posted for all ten in the hand-back.
  console.log("\nT-109 clause 1 — real corpus residual, all providers:");
  for (const line of report) console.log("  " + line);

  for (const p of providers) {
    const sighted = providerSightedNoPlant[p];
    const graded = providerStrataNoPlant[p];
    const excl = providerExcludedByShapeNoPlant[p] || {
      SEES_NO: 0,
      ECHO: 0,
      NO_ANSWER: 0,
    };
    const gradedN = graded ? graded.n : 0;
    const exclTotal = excl.SEES_NO + excl.ECHO + excl.NO_ANSWER;
    assert.equal(
      sighted.n - gradedN - exclTotal,
      0,
      `residual for ${p} should be 0`,
    );
    if (graded) {
      assert.equal(
        graded.ok,
        sighted.ok,
        `graded.ok and sighted.ok should agree for ${p} — same right-count, two populations`,
      );
    }
  }
});

test("real corpus: providerSightedCellsNoPlant's per-count cells sum to providerSightedNoPlant's own n/ok (the PROVIDER x TRUTH.COUNT table and the ranking read the same population two different ways)", () => {
  const { providerSightedNoPlant, providerSightedCellsNoPlant } =
    auditShapes(CORPUS_DIR);

  const providers = Object.keys(providerSightedNoPlant).sort();
  for (const p of providers) {
    const cells = providerSightedCellsNoPlant[p];
    assert.ok(cells, `expected providerSightedCellsNoPlant to hold ${p}`);
    let n = 0,
      ok = 0;
    for (const cell of cells.values()) {
      n += cell.n;
      ok += cell.ok;
    }
    assert.equal(
      n,
      providerSightedNoPlant[p].n,
      `${p}: per-count cell n's should sum to the provider's own sighted n`,
    );
    assert.equal(
      ok,
      providerSightedNoPlant[p].ok,
      `${p}: per-count cell ok's should sum to the provider's own sighted ok`,
    );
  }
});

test("real corpus: providerCountCellsNoPlant's per-count cells sum to providerStrataNoPlant's own n/ok (the graded half of the same check)", () => {
  const { providerStrataNoPlant, providerCountCellsNoPlant } =
    auditShapes(CORPUS_DIR);

  const providers = Object.keys(providerStrataNoPlant).sort();
  for (const p of providers) {
    const cells = providerCountCellsNoPlant[p];
    assert.ok(cells, `expected providerCountCellsNoPlant to hold ${p}`);
    let n = 0,
      ok = 0;
    for (const cell of cells.values()) {
      n += cell.n;
      ok += cell.ok;
    }
    assert.equal(n, providerStrataNoPlant[p].n, `${p}: graded cell n sum`);
    assert.equal(ok, providerStrataNoPlant[p].ok, `${p}: graded cell ok sum`);
  }
});

test("real corpus: providerSightedCells (plant-including) sums to providerSighted's own n/ok (the cross-tab, count=9 region analysis and coverage-hole sentence all read this ORIGINAL pair, not the NoPlant one)", () => {
  const { providerSighted, providerSightedCells } = auditShapes(CORPUS_DIR);

  const providers = Object.keys(providerSighted).sort();
  for (const p of providers) {
    const cells = providerSightedCells[p];
    assert.ok(cells, `expected providerSightedCells to hold ${p}`);
    let n = 0,
      ok = 0;
    for (const cell of cells.values()) {
      n += cell.n;
      ok += cell.ok;
    }
    assert.equal(n, providerSighted[p].n, `${p}: sighted cell n sum`);
    assert.equal(ok, providerSighted[p].ok, `${p}: sighted cell ok sum`);
  }
});

test("real corpus: providerCountCells (plant-including) sums to providerStrata's own n/ok — the pair the PROVIDER x TRUTH.COUNT cross-tab, the count=9 Fisher test and the COVERAGE HOLE sentence all read directly", () => {
  const { providerStrata, providerCountCells } = auditShapes(CORPUS_DIR);

  const providers = Object.keys(providerStrata).sort();
  for (const p of providers) {
    const cells = providerCountCells[p];
    assert.ok(cells, `expected providerCountCells to hold ${p}`);
    let n = 0,
      ok = 0;
    for (const cell of cells.values()) {
      n += cell.n;
      ok += cell.ok;
    }
    assert.equal(
      n,
      providerStrata[p].n,
      `${p}: graded (plant-including) cell n sum`,
    );
    assert.equal(
      ok,
      providerStrata[p].ok,
      `${p}: graded (plant-including) cell ok sum`,
    );
  }
});

test("real corpus: the no-reply headline's per-provider n equals bridgeAttributable+unattributed", () => {
  // T-107's own identity — checked here as a real assertion rather than a
  // one-off hand-computation. Holds BY CONSTRUCTION today (n++ always
  // runs, then exactly one of bridgeAttributable++/unattributed++ runs in
  // the same branch) — asserted anyway so a future refactor that
  // separates these increments is caught here, not by a reader doing the
  // arithmetic on a printed report.
  const { noReplyByProvider } = auditShapes(CORPUS_DIR);

  for (const p of Object.keys(noReplyByProvider)) {
    const nr = noReplyByProvider[p];
    assert.equal(
      nr.n,
      nr.bridgeAttributable + nr.unattributed,
      `${p}: n should equal bridgeAttributable+unattributed`,
    );
  }
});

test("real corpus: formatNoReplySection's printed per-provider lines sum to its own printed total, and that total plus sightedRowsWithRaw is the denominator it states", () => {
  // T-109 review, finding 1: a prior version of this test compared
  // `providers.reduce(...)` against `providers.reduce(...)` over the SAME
  // array inside the test itself — a tautology that would pass on
  // fabricated data and never touches production code at all.
  // formatNoReplySection (scripts/shape-audit.mjs) is never imported by
  // that version; it is here.
  //
  // Finding 2: the real cross-population risk in this section is that its
  // headline total (`noReplyTotal`) reduces over
  // Object.keys(noReplyByProvider) ALONE, while the per-provider lines
  // printed below it iterate `allSweptProviders` — the UNION of
  // Object.keys(providerSighted) and Object.keys(noReplyByProvider). Two
  // different key sets feeding one printed block; a reader who sums the
  // per-provider column and compares it to the headline is checking
  // exactly the relation this test asserts, against the real, printed
  // lines rather than against internal state formatNoReplySection never
  // exposes directly.
  const { noReplyByProvider, providerSighted, rowsWithRaw, blindRowsWithRaw } =
    auditShapes(CORPUS_DIR);
  const sightedRowsWithRaw = rowsWithRaw - blindRowsWithRaw;

  const lines = formatNoReplySection(
    noReplyByProvider,
    providerSighted,
    sightedRowsWithRaw,
  );

  const headlineMatch = lines[0].match(
    /:\s*(\d+) of (\d+) sighted gradable rows/,
  );
  assert.ok(headlineMatch, `expected a parseable headline, got: ${lines[0]}`);
  const printedTotal = Number(headlineMatch[1]);
  const printedDenominator = Number(headlineMatch[2]);

  let summedFromRows = 0;
  let rowCount = 0;
  for (const line of lines.slice(1)) {
    const rowMatch = line.match(
      /^\s*(\S+)\s+(\d+)\s+bridge-attributable=(\d+)\s+unattributed=(\d+)/,
    );
    assert.ok(rowMatch, `expected a parseable per-provider line, got: ${line}`);
    summedFromRows += Number(rowMatch[2]);
    rowCount++;
  }
  assert.ok(rowCount > 0, "expected at least one per-provider line");

  assert.equal(
    summedFromRows,
    printedTotal,
    "the per-provider lines should sum to the headline's own total",
  );
  assert.equal(
    sightedRowsWithRaw + printedTotal,
    printedDenominator,
    "sightedRowsWithRaw + the headline's total should equal the headline's own denominator",
  );
});
