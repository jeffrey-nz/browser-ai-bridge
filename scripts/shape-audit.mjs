#!/usr/bin/env node
/**
 * shape-audit.mjs — T-027. `shape` stored in reports/vision-probe/*.json is a
 * measurement taken once, at write time, by whatever classify() said that
 * day (see the comment beside `const cls = classify(...)` in
 * vision-probe.mjs). It is never backfilled when the classifier is later
 * corrected — same policy as gradingProvenance()'s sha/commit fields, and
 * for the same reason: stamping today's grading onto yesterday's run would
 * turn an honest "this was graded by an older classifier" into a silent,
 * confident falsehood.
 *
 * This script is the reader-side half of that policy: it recomputes `shape`
 * from each row's stored `raw` via the CURRENT classify(), and reports every
 * row where the two disagree — so "the corpus disagrees with HEAD" is
 * something anyone can see printed, not something that has to be
 * rediscovered by hand each time the classifier changes. It does not
 * change anything on disk; `raw` is evidence and `shape` is left exactly as
 * recorded.
 *
 * Prints, does not fail the suite (see tests/shapeAudit.test.js for the
 * pinned unit test of the comparison logic itself, against synthetic rows —
 * not against this real corpus, which is expected to accumulate new
 * disagreements every time classify() is corrected; that is drift, not
 * regression, and a check that fails the build on drift would either be
 * disabled at the first real classifier fix or force a backfill this
 * ticket's own policy says not to do).
 *
 * Usage: node scripts/shape-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classify, MIN_COUNT, COUNT_RANGE } from "./vision-probe.mjs";

const MAX_COUNT = MIN_COUNT + COUNT_RANGE - 1;

export function auditShapes(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let rowsWithRaw = 0;
  // T-088: `rowsWithRaw` counts EVERY row with raw text — blind (no
  // picture at all, vision-probe.mjs --blind) and sighted alike — while
  // every truth-gated table below (countStrata, providerStrata, the
  // exclusion tables, out-of-range, and now wrongRows) runs on sighted
  // rows only, because a blind row carries no `truth` to grade a COUNT or
  // COLOR against. Blind rows correctly stay IN the shape histogram (a
  // blind SEES_NO is still a real, correctly-shaped reply — the histogram
  // is a shape tally, not a correctness rate) but the headline must say so
  // explicitly, or a reader has no way to know the histogram's denominator
  // and the tables' denominator are two different populations that happen
  // to both be printed under one number.
  let blindRowsWithRaw = 0;
  const disagreements = [];
  const storedHistogram = {};
  const recomputedHistogram = {};
  // T-050: COUNT right/wrong is a rate ON THE STIMULUS a row was measured
  // against, not a provider-general accuracy figure — a live paired test
  // (this ticket) found one provider go 0/3 at truth.count=9 and 3/3 at
  // truth.count=4 with no code change between them. A single histogram
  // collapsing every count together hides exactly that swing; bucket by
  // truth.count instead, computed fresh from the JSON on disk each run —
  // never hand-typed, so it cannot go stale the way a sentence would.
  //
  // T-063: truth.count is not the only thing that varies row to row — WHICH
  // PROVIDERS were swept on any given day varies too, and that second
  // covariate correlates with the outcome harder than count does (measured:
  // pooling the 3-5/6-9 bands over whatever provider set happened to be
  // present in each moved the gap from 100.0/60.0, over the 6 providers with
  // rows in both bands, to 91.7/68.4 pooled — 17 points, in the reassuring
  // direction, from 3 of 9 providers appearing in one band only). `providers`
  // per stratum (a Set, not a count typed by hand) and `providerBand` (every
  // provider's own easy/hard tally, so pooled and paired-only can both be
  // computed from the same source) exist so a reader — or this script's own
  // printed line — never has to pool across an unstated, uneven provider mix
  // to get a headline number.
  const countStrata = {};
  const providerBand = {};
  // T-063 clause 4: is the SEES_NO/ECHO/NO_ANSWER exclusion itself
  // count-dependent? If the drop rate rises with truth.count, the COUNT-right
  // rate above is silently measured on an easier-selected subset at the hard
  // end, on top of the provider-mix effect above. `shapeByCount` carries every
  // recomputed shape (not just the structured ones countStrata keeps), keyed
  // by truth.count, so the answer is read off the same pass, not assumed.
  const shapeByCount = {};
  const EXCLUDED_SHAPES = new Set(["SEES_NO", "ECHO", "NO_ANSWER"]);
  // T-065: shapeByCount's 46.4-point spread across counts is the SAME
  // provider-mix covariate T-063 already named, reappearing in a second
  // table — by band (easy/hard) the exclusion rate barely moves (2.6
  // points), by provider it moves the entire range (0% to 100%). Tracked
  // per (provider, band) — not just per provider — so a provider named as
  // "unpaired" in bandStats() can be told apart by WHICH KIND of absence it
  // is: zero rows in that band at all, versus rows that exist and were all
  // excluded (a measurement property of that provider, not a scheduling
  // gap more sweeping would fix). Same gate as shapeByCount (raw present,
  // truth.count present) — deliberately NOT gated on countOk, unlike
  // providerBand above, because an excluded row by definition never gets a
  // countOk verdict and would be invisible to this table if it were.
  const exclusionByProviderBand = {};
  // T-076: a WRONG count outside MIN_COUNT..MAX_COUNT names a picture the
  // generator could never have drawn — strictly stronger than "got it
  // wrong". classify() already flags this (outOfRange, derived from the
  // SAME two constants, not a second "3 to 9"); collected here so the
  // adjacent-to-boundary split (a miscount by a model that was looking)
  // can be told apart from everything else (a fabrication by one that
  // wasn't) — see the LIMIT in the comment above classify()'s own check,
  // which applies here identically: a zero count here is not evidence
  // nobody fabricated, only that nobody fabricated conspicuously.
  const outOfRangeRows = [];
  // T-084 clause 5: a per-provider rate is only comparable to another
  // provider's if they were shown comparable stimuli — gemini has seen all
  // 7 counts, perplexity exactly 1. Tracked per provider as the SET of
  // truth.count values it has ever been graded against (same structured
  // gate countStrata/providerBand use), so "gemini 100%, deepseek 79%"
  // cannot be printed as a ranking without the coverage that makes it one
  // printed right beside it.
  const providerStrata = {};
  // T-092: providerId -> Map(truth.count -> {n, ok}) — the cross-tab
  // providerStrata's own totals cannot show. See the comment where it is
  // populated below for why this exists.
  const providerCountCells = {};
  // T-084 clause 4: vision-probe.mjs's header already argues WRONG is not
  // an upload bug — "the model saw *something* and was confidently mistaken
  // about it". Collected here so that argument has numbers behind it in an
  // ARTEFACT, not only in a comment: how many WRONG rows named the colour
  // correctly anyway (positive evidence of arrival on a field the model got
  // right), printed beside T-072's blind-arm null (0 of N informative blind
  // turns ever state a count at all).
  const wrongRows = [];
  // T-078: the denominator the zero-tally line below needs — "0 of N" vs
  // "0 of 0" are different facts and only the corpus knows which. Same
  // population outOfRangeRows is drawn from (a structured reply, one that
  // carried a countOk verdict at all), counted alongside countStrata's own
  // gate rather than summed from it after the fact, so this can never drift
  // from what countStrata actually bucketed.
  let structuredCount = 0;

  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    const isBlindFile = j.blind === true;
    for (const r of j.results || []) {
      if (r.raw == null) continue;
      rowsWithRaw++;
      if (isBlindFile) blindRowsWithRaw++;
      storedHistogram[r.shape] = (storedHistogram[r.shape] || 0) + 1;
      // T-088: a blind file carries no `truth` (nothing was drawn or
      // sent), so `j.truth` is undefined here on every blind row. Calling
      // classify(r.raw, undefined) is not merely ungraded — classify()'s
      // structured-reply branch dereferences `truth.count` unconditionally
      // and THROWS on undefined, confirmed live. It has never fired
      // because 0 of every blind turn recorded so far states a count
      // (T-072), but that is a fact about today's corpus, not a guarantee.
      // Mirrors ia-grade.mjs's own gradeBlindReply(), which already passes
      // this exact sentinel to classify() for the same reason: a
      // structured reply on a blind row correctly lands as WRONG (countOk
      // false against a count of null, colorOk false against an empty
      // string) instead of crashing the audit.
      const recomputed = classify(
        r.raw,
        isBlindFile ? { count: null, color: "" } : j.truth,
      );
      recomputedHistogram[recomputed.shape] =
        (recomputedHistogram[recomputed.shape] || 0) + 1;
      if (recomputed.shape !== r.shape) {
        disagreements.push({
          file: f,
          providerId: r.providerId,
          storedShape: r.shape,
          recomputedShape: recomputed.shape,
        });
      }

      // T-088 clause 3: gated the SAME way every other truth-dependent
      // table in this file is (countStrata, providerStrata, exclusion,
      // out-of-range) — a blind row has no truth for colorOk to mean
      // anything against, so it does not belong in the WRONG-bucket
      // population even on the day classify() (now sentinel-truthed
      // above) stops throwing and starts returning a shape for one.
      if (recomputed.shape === "WRONG" && j.truth?.count !== undefined) {
        wrongRows.push({
          file: f,
          providerId: r.providerId,
          colorOk: recomputed.colorOk,
        });
      }

      if (recomputed.outOfRange && j.truth?.count !== undefined) {
        const m = /COUNT\s*=\s*(\d+)/i.exec(r.raw ?? "");
        const said = m ? Number(m[1]) : null;
        outOfRangeRows.push({
          file: f,
          providerId: r.providerId,
          truth: j.truth.count,
          said,
          imageAttached: r.imageAttached,
          onBoundary: said === MAX_COUNT + 1 && j.truth.count === MAX_COUNT,
        });
      }

      if (j.truth?.count !== undefined) {
        const cell = (shapeByCount[j.truth.count] ??= {
          total: 0,
          excluded: 0,
        });
        cell.total++;
        const isExcluded = EXCLUDED_SHAPES.has(recomputed.shape);
        if (isExcluded) cell.excluded++;

        const band = j.truth.count <= 5 ? "easy" : "hard";
        const pb = (exclusionByProviderBand[r.providerId] ??= {});
        const pcell = (pb[band] ??= { total: 0, excluded: 0 });
        pcell.total++;
        if (isExcluded) pcell.excluded++;
      }

      // Same denominator vision-probe.mjs's own summary line uses: the
      // STRUCTURED subset (a row that carried a countOk verdict at all —
      // PASS/COUNT_ONLY/WRONG), keyed by the truth it was actually drawn
      // against.
      if (recomputed.countOk !== undefined && j.truth?.count !== undefined) {
        structuredCount++;
        const bucket = (countStrata[j.truth.count] ??= {
          n: 0,
          ok: 0,
          providers: new Set(),
        });
        bucket.n++;
        bucket.providers.add(r.providerId);
        if (recomputed.countOk) bucket.ok++;

        const ps = (providerStrata[r.providerId] ??= {
          countsShown: new Set(),
          n: 0,
          ok: 0,
        });
        ps.countsShown.add(j.truth.count);
        ps.n++;
        if (recomputed.countOk) ps.ok++;

        // T-092: the per-cell breakdown providerStrata's own SUMMED n/ok
        // cannot show — "mistral 57%" and "copilot 80%" read as two
        // providers doing differently, when six of this board's nine
        // recorded errors are copilot's and mistral's SAME failure at the
        // SAME stratum (count=9), and the gap between them is that 43% of
        // mistral's rows sit there against 20% of copilot's.
        const pc = (providerCountCells[r.providerId] ??= new Map());
        const cell2 = pc.get(j.truth.count) ?? { n: 0, ok: 0 };
        cell2.n++;
        if (recomputed.countOk) cell2.ok++;
        pc.set(j.truth.count, cell2);

        const band = j.truth.count <= 5 ? "easy" : "hard";
        const pb = (providerBand[r.providerId] ??= {});
        const cell = (pb[band] ??= { n: 0, ok: 0 });
        cell.n++;
        if (recomputed.countOk) cell.ok++;
      }
    }
  }

  return {
    rowsWithRaw,
    blindRowsWithRaw,
    disagreements,
    storedHistogram,
    recomputedHistogram,
    countStrata,
    providerBand,
    shapeByCount,
    exclusionByProviderBand,
    outOfRangeRows,
    structuredCount,
    providerStrata,
    providerCountCells,
    wrongRows,
  };
}

// T-065: exclusionByProviderBand → the same "by band" and "by provider"
// summaries clause 1 wants, plus (for a given set of provider ids — the
// ones bandStats() found unpaired) which KIND of absence each one is.
// Pulled out for the same reason bandStats() was: testable against
// synthetic data, and the classification ("no rows" vs "rows, excluded")
// is exactly the distinction the ticket's own goal draws between a
// scheduling gap and a measurement property.
export function exclusionStats(exclusionByProviderBand) {
  const byBand = {
    easy: { total: 0, excluded: 0 },
    hard: { total: 0, excluded: 0 },
  };
  const byProvider = {};
  const fullyExcluded = [];
  for (const providerId of Object.keys(exclusionByProviderBand).sort()) {
    const bands = exclusionByProviderBand[providerId];
    const totals = { total: 0, excluded: 0 };
    for (const band of ["easy", "hard"]) {
      const cell = bands[band];
      if (!cell) continue;
      byBand[band].total += cell.total;
      byBand[band].excluded += cell.excluded;
      totals.total += cell.total;
      totals.excluded += cell.excluded;
    }
    byProvider[providerId] = totals;
    if (totals.total > 0 && totals.excluded === totals.total) {
      fullyExcluded.push(providerId);
    }
  }
  return { byBand, byProvider, fullyExcluded };
}

// T-065: classifies ONE unpaired provider (bandStats()'s own output) as
// either genuinely absent from a band (0 rows) or present-but-fully-dropped
// (rows exist, all excluded) — "unpaired because nobody swept it" versus
// "unpaired because every row it produced got dropped" are different
// findings and bandStats()'s unpaired list alone cannot tell them apart.
export function classifyAbsence(exclusionByProviderBand, providerId, band) {
  const cell = exclusionByProviderBand[providerId]?.[band];
  if (!cell || cell.total === 0)
    return { kind: "absent", total: 0, excluded: 0 };
  if (cell.excluded === cell.total) {
    return { kind: "all-excluded", total: cell.total, excluded: cell.excluded };
  }
  return { kind: "mixed", total: cell.total, excluded: cell.excluded };
}

// T-063: pulled out of main() so the pooled-vs-paired distinction is
// unit-testable against synthetic providerBand data, same reasoning as
// auditShapes() itself being separate from main()'s printing. A provider
// with a stratum in only one band is named, not silently dropped from the
// pooled figure — pooled and paired answer different questions and this
// script must not choose one for the reader.
export function bandStats(providerBand) {
  const pooled = { easy: { n: 0, ok: 0 }, hard: { n: 0, ok: 0 } };
  const paired = { easy: { n: 0, ok: 0 }, hard: { n: 0, ok: 0 } };
  const unpaired = [];
  let pairedCount = 0;
  for (const providerId of Object.keys(providerBand).sort()) {
    const easy = providerBand[providerId].easy;
    const hard = providerBand[providerId].hard;
    if (easy) {
      pooled.easy.n += easy.n;
      pooled.easy.ok += easy.ok;
    }
    if (hard) {
      pooled.hard.n += hard.n;
      pooled.hard.ok += hard.ok;
    }
    if (easy && hard) {
      pairedCount++;
      paired.easy.n += easy.n;
      paired.easy.ok += easy.ok;
      paired.hard.n += hard.n;
      paired.hard.ok += hard.ok;
    } else {
      unpaired.push({ providerId, band: easy ? "easy" : "hard" });
    }
  }
  return { pooled, paired, pairedCount, unpaired };
}

// T-092: "gemini 100%, deepseek 79%" is a ranking over stimulus sets that
// are not the same size or shape — five providers were shown every count,
// deepseek was shown four, perplexity one. Direct standardisation to the
// corpus's own stratum mix answers "if this provider had been shown the
// SAME mix everyone else was, weighted by how much of the corpus sits at
// each count it actually WAS shown" — renormalised over the strata a
// provider actually holds (an unheld stratum contributes no weight, not a
// zero), with the covered weight travelling beside the number so a reader
// can see how much of that renormalisation is doing the work. A provider
// at 31% covered weight has a standardised rate that is mostly an
// assumption, and printing the number without the weight would hide that.
export function computeStandardizedRates(providerCountCells, countStrata) {
  const totalN = Object.values(countStrata).reduce((s, c) => s + c.n, 0);
  const result = {};
  for (const [providerId, cells] of Object.entries(providerCountCells)) {
    let n = 0,
      ok = 0,
      numerator = 0,
      weightCovered = 0;
    const strataHeld = [...cells.keys()].sort((a, b) => a - b);
    for (const [count, cell] of cells) {
      n += cell.n;
      ok += cell.ok;
      const weight = totalN ? countStrata[count].n / totalN : 0;
      numerator += weight * (cell.ok / cell.n);
      weightCovered += weight;
    }
    result[providerId] = {
      n,
      ok,
      crude: n ? ok / n : null,
      standardized: weightCovered ? numerator / weightCovered : null,
      weightCovered,
      strataHeld,
    };
  }
  return result;
}

// T-092: a plain hypergeometric two-sided Fisher exact test over a 2x2
// table — no library, this repo has no stats dependency and one 2x2 test
// does not justify adding one. Sums the probability of every table with
// the SAME margins whose probability is no greater than the observed
// table's (the standard two-sided definition), computed in log-space so
// n up to a few hundred does not overflow. Pinned in
// tests/shapeAudit.test.js against a table with a known published p-value
// (Fisher's own "lady tasting tea": 3,1/1,3 -> p=0.4857) before trusting
// it on anything this file actually reports.
function logFactorial(n) {
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}
export function fisherExactTwoSided(a, b, c, d) {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  const n = row1 + row2;
  const minX = Math.max(0, row1 - col2);
  const maxX = Math.min(row1, col1);
  const logProb = (x) =>
    logChoose(col1, x) + logChoose(col2, row1 - x) - logChoose(n, row1);
  const observed = logProb(a);
  // Floating-point tolerance on the "no greater than" comparison — without
  // it, the observed table's own probability can fail to compare equal to
  // itself due to summation-order rounding in logChoose.
  const EPS = 1e-9;
  let p = 0;
  for (let x = minX; x <= maxX; x++) {
    const lp = logProb(x);
    if (lp <= observed + EPS) p += Math.exp(lp);
  }
  return p;
}

function main() {
  const dir = path.join(process.cwd(), "reports", "vision-probe");
  const {
    rowsWithRaw,
    blindRowsWithRaw,
    disagreements,
    storedHistogram,
    recomputedHistogram,
    countStrata,
    providerBand,
    shapeByCount,
    exclusionByProviderBand,
    outOfRangeRows,
    structuredCount,
    providerStrata,
    providerCountCells,
    wrongRows,
  } = auditShapes(dir);

  // T-088: the headline used to read as the denominator for every table
  // beneath it, and it is not — blind rows (no truth, nothing drawn or
  // sent) stay in the shape histogram just below (a real, correctly-
  // shaped reply, not a correctness verdict) but are excluded from every
  // truth-gated table after it. Stating both counts here means a reader
  // reaches the exclusion table's denominator by reading, not subtracting.
  const sightedRowsWithRaw = rowsWithRaw - blindRowsWithRaw;
  console.log(
    `rows with raw: ${rowsWithRaw}   (${sightedRowsWithRaw} sighted, ${blindRowsWithRaw} blind — the histogram below includes both; every table after it is sighted-only)   disagreements: ${disagreements.length}`,
  );
  for (const d of disagreements) {
    console.log(
      `   ${d.file}  ${d.providerId}  ${d.storedShape} -> ${d.recomputedShape}`,
    );
  }
  console.log(`stored histogram:     ${JSON.stringify(storedHistogram)}`);
  console.log(`recomputed histogram: ${JSON.stringify(recomputedHistogram)}`);

  console.log("\nCOUNT right, by truth.count (T-050 — a rate on the");
  console.log("stimulus, not on the provider — see the file header):");
  const counts = Object.keys(countStrata)
    .map(Number)
    .sort((a, b) => a - b);
  for (const c of counts) {
    const { n, ok, providers } = countStrata[c];
    const pct = ((ok / n) * 100).toFixed(1);
    console.log(
      `  truth.count=${c}   ${ok}/${n}   ${pct}%   (${providers.size} provider${providers.size === 1 ? "" : "s"})`,
    );
  }

  // T-092 clause 1: the cross-tab shape-audit has never printed. Mostly
  // empty, and that emptiness IS the message — T-084's "one stratum of
  // seven" is a statement about the pool; this is where a reader sees
  // which PROVIDERS that stratum actually belongs to.
  const providerIdsCT = Object.keys(providerCountCells).sort();
  if (providerIdsCT.length > 0) {
    console.log("\nPROVIDER x TRUTH.COUNT, ok/n (T-092 — the table the");
    console.log(
      "per-provider rate below has never shown; '.' = no rows at that stratum):",
    );
    console.log(
      "  " +
        "".padEnd(11) +
        counts.map((c) => `c=${c}`.padStart(6)).join("") +
        "  pooled",
    );
    for (const p of providerIdsCT) {
      const cells = providerCountCells[p];
      let n = 0,
        ok = 0;
      const row = counts
        .map((c) => {
          const cell = cells.get(c);
          if (!cell) return "".padStart(6, " ").slice(0, 5) + " .";
          n += cell.n;
          ok += cell.ok;
          return `${cell.ok}/${cell.n}`.padStart(6);
        })
        .join("");
      console.log(`  ${p.padEnd(11)}${row}  ${ok}/${n}`);
    }
  }

  // T-084 clause 5 / T-092 review: "gemini 100%, deepseek 79%" reads as a
  // ranking and is really a statement about which tickets happened to
  // call which provider — printed here beside the stimulus range each
  // rate actually covers. T-092: the table used to SORT by that same
  // crude rate, asserting through its own ordering exactly what this
  // caption denies. Sorted by STANDARDISED rate instead (direct
  // standardisation to the corpus's own stratum mix, renormalised over
  // the strata a provider actually holds) — crude rate is still printed,
  // unchanged, beside it; only the ORDER and the two new columns changed.
  const standardized = computeStandardizedRates(
    providerCountCells,
    countStrata,
  );
  const providerIds5 = Object.keys(providerStrata).sort((a, b) => {
    const sa = standardized[a]?.standardized ?? -1;
    const sb = standardized[b]?.standardized ?? -1;
    return sb - sa;
  });
  if (providerIds5.length > 0) {
    console.log(
      "\nPer-provider rate, WITH the strata it was actually shown (T-084 —",
    );
    console.log(
      "a ranking over incomparable stimulus sets is not a ranking; sorted",
    );
    console.log(
      "by STANDARDISED rate, not crude, so the order does not assert what",
    );
    console.log("this caption denies — T-092):");
    for (const p of providerIds5) {
      const { n, ok, countsShown } = providerStrata[p];
      const pct = ((ok / n) * 100).toFixed(0);
      const shown = [...countsShown].sort((a, b) => a - b);
      const std = standardized[p];
      const stdPct =
        std?.standardized != null ? (std.standardized * 100).toFixed(1) : "?";
      const weightPct =
        std?.weightCovered != null ? (std.weightCovered * 100).toFixed(1) : "?";
      console.log(
        `  ${p.padEnd(11)} crude ${ok}/${n} ${pct.padStart(3)}%   standardised ${stdPct}%   corpus weight covered ${weightPct}%   strata shown (of ${COUNT_RANGE}): ${shown.length}/${COUNT_RANGE}  [${shown.join(",")}]`,
      );
    }
  }

  // T-092 clause 4: the two within-region provider effects, stated as
  // findings rather than left for a reader to notice in the cells above.
  const cell9 = (p) => providerCountCells[p]?.get(MAX_COUNT);
  const hardProviders = providerIdsCT.filter((p) => cell9(p));
  const hardOk = hardProviders.reduce((s, p) => s + cell9(p).ok, 0);
  const hardN = hardProviders.reduce((s, p) => s + cell9(p).n, 0);
  const failedAtHard = hardProviders.filter((p) => cell9(p).ok === 0);
  const heldAtHard = hardProviders.filter((p) => cell9(p).ok === cell9(p).n);
  if (
    hardProviders.length > 1 &&
    failedAtHard.length > 0 &&
    heldAtHard.length > 0
  ) {
    const a = heldAtHard.reduce((s, p) => s + cell9(p).ok, 0);
    const b = heldAtHard.reduce((s, p) => s + (cell9(p).n - cell9(p).ok), 0);
    const c = failedAtHard.reduce((s, p) => s + cell9(p).ok, 0);
    const d = failedAtHard.reduce((s, p) => s + (cell9(p).n - cell9(p).ok), 0);
    const p9 = fisherExactTwoSided(a, b, c, d);
    console.log(
      `\nAt truth.count=${MAX_COUNT}: ${heldAtHard.join("/")} ${a} right, ${b} wrong` +
        `   vs   ${failedAtHard.join("/")} ${c} right, ${d} wrong` +
        `   Fisher exact two-sided p = ${p9.toExponential(2)}`,
    );
  }
  const lowRegion = counts.filter((c) => c !== MAX_COUNT);
  const lowByProvider = {};
  for (const p of providerIdsCT) {
    let n = 0,
      ok = 0;
    for (const c of lowRegion) {
      const cell = providerCountCells[p].get(c);
      if (cell) {
        n += cell.n;
        ok += cell.ok;
      }
    }
    if (n > 0) lowByProvider[p] = { n, ok };
  }
  const lowErring = Object.keys(lowByProvider).filter(
    (p) => lowByProvider[p].ok < lowByProvider[p].n,
  );
  if (lowErring.length > 0) {
    const a = lowErring.reduce((s, p) => s + lowByProvider[p].ok, 0);
    const b = lowErring.reduce(
      (s, p) => s + (lowByProvider[p].n - lowByProvider[p].ok),
      0,
    );
    const rest = Object.keys(lowByProvider).filter(
      (p) => !lowErring.includes(p),
    );
    const c = rest.reduce((s, p) => s + lowByProvider[p].ok, 0);
    const d = rest.reduce(
      (s, p) => s + (lowByProvider[p].n - lowByProvider[p].ok),
      0,
    );
    const pLow = fisherExactTwoSided(a, b, c, d);
    console.log(
      `At counts ${lowRegion[0]}-${lowRegion[lowRegion.length - 1]}: ${lowErring.join("/")} ${a} right, ${b} wrong` +
        `   vs   every other provider ${c} right, ${d} wrong` +
        `   Fisher exact two-sided p = ${pLow.toExponential(2)}`,
    );
  }

  // T-092 clause 5: the one coverage hole that decides whether the
  // count=9 effect belongs to two providers or three, named rather than
  // filled by a sweep. Computed, not asserted: true only if a provider has
  // rows at some count but none at the top of the range AND has a
  // recorded error somewhere it WAS shown.
  const neverShownHard = providerIdsCT.filter(
    (p) => !providerCountCells[p].has(MAX_COUNT),
  );
  const erringElsewhere = neverShownHard.filter((p) => {
    const cells = providerCountCells[p];
    for (const cell of cells.values()) if (cell.ok < cell.n) return true;
    return false;
  });
  if (erringElsewhere.length > 0) {
    for (const p of erringElsewhere) {
      const std = standardized[p];
      const weightPct =
        std?.weightCovered != null ? (std.weightCovered * 100).toFixed(1) : "?";
      console.log(
        `\nCOVERAGE HOLE: ${p} has never been graded at truth.count=${MAX_COUNT} ` +
          `(${weightPct}% of corpus weight covered) and has a recorded error at a ` +
          `count it WAS shown — whether it fails at ${MAX_COUNT} like the providers ` +
          `above, or holds like the rest, is unmeasured, and that single gap decides ` +
          `whether the count=${MAX_COUNT} effect belongs to two providers or three.`,
      );
    }
  }

  // T-063: the pooled 3-5/6-9 line alone hides that the provider SET differs
  // between the two bands — see bandStats()'s own comment. Print pooled
  // (every row, the number this script always printed) alongside paired
  // (only providers with rows in BOTH bands, the only figure a same-provider
  // comparison actually supports), and name who got left out of paired.
  let unpaired = [];
  if (counts.length > 0) {
    const stats = bandStats(providerBand);
    unpaired = stats.unpaired;
    const { pooled, paired, pairedCount } = stats;
    const fmt = (b) =>
      `${b.ok}/${b.n} ${b.n > 0 ? ((b.ok / b.n) * 100).toFixed(1) : "0.0"}%`;
    console.log(
      `  count 3-5 (pooled, all providers): ${fmt(pooled.easy)}   ` +
        `count 6-9 (pooled): ${fmt(pooled.hard)}`,
    );
    console.log(
      `  count 3-5 (paired providers only, N=${pairedCount}): ${fmt(paired.easy)}   ` +
        `count 6-9 (paired): ${fmt(paired.hard)}`,
    );
    if (unpaired.length > 0) {
      console.log(
        `  unpaired (rows in one band only, excluded from the paired line): ` +
          unpaired.map((u) => `${u.providerId} (${u.band} only)`).join(", "),
      );
    }
  }

  // T-063 clause 4: is the SEES_NO/ECHO/NO_ANSWER exclusion itself
  // count-dependent? A rising drop rate at higher counts would mean the
  // COUNT-right rate above is measured on an increasingly easier-selected
  // subset as truth.count grows, stacking on top of the provider-mix effect.
  const excludedCounts = Object.keys(shapeByCount)
    .map(Number)
    .sort((a, b) => a - b);
  if (excludedCounts.length > 0) {
    console.log(
      "\nExcluded from COUNT (SEES_NO/ECHO/NO_ANSWER), by truth.count —",
    );
    console.log("checking whether the exclusion itself tracks count:");
    let totalAll = 0,
      excludedAll = 0;
    const rates = [];
    for (const c of excludedCounts) {
      const { total, excluded } = shapeByCount[c];
      const rate = (excluded / total) * 100;
      rates.push(rate);
      totalAll += total;
      excludedAll += excluded;
      console.log(
        `  truth.count=${c}   ${excluded}/${total} excluded   ${rate.toFixed(1)}%`,
      );
    }
    const overall = (excludedAll / totalAll) * 100;
    const spread = Math.max(...rates) - Math.min(...rates);
    console.log(
      `  overall: ${excludedAll}/${totalAll} excluded   ${overall.toFixed(1)}%   ` +
        `spread across counts: ${spread.toFixed(1)} points`,
    );
  }

  // T-065: the by-count spread above is the provider-mix covariate T-063
  // named, reappearing in a second table — by BAND the rate barely moves;
  // by PROVIDER it is the whole 0-100% range. Printed side by side so a
  // reader is pointed at the covariate that's actually doing the moving.
  const { byBand, byProvider, fullyExcluded } = exclusionStats(
    exclusionByProviderBand,
  );
  const providerIds = Object.keys(byProvider).sort();
  if (providerIds.length > 0) {
    const bandRate = (b) => (b.total > 0 ? (b.excluded / b.total) * 100 : 0);
    const bandSpread = Math.abs(bandRate(byBand.hard) - bandRate(byBand.easy));
    console.log(
      "\nSame exclusion, by band vs by provider (T-065 — by-count spread",
    );
    console.log("above is the provider mix again, not a count effect):");
    console.log(
      `  by band:      easy 3-5 ${byBand.easy.excluded}/${byBand.easy.total} ` +
        `${bandRate(byBand.easy).toFixed(1)}%   hard 6-9 ${byBand.hard.excluded}/${byBand.hard.total} ` +
        `${bandRate(byBand.hard).toFixed(1)}%   spread: ${bandSpread.toFixed(1)} points`,
    );
    const providerRates = providerIds.map((p) => {
      const { total, excluded } = byProvider[p];
      return total > 0 ? (excluded / total) * 100 : 0;
    });
    const providerSpread =
      Math.max(...providerRates) - Math.min(...providerRates);
    console.log(
      `  by provider:  ` +
        providerIds
          .map((p) => {
            const { total, excluded } = byProvider[p];
            const pct =
              total > 0 ? ((excluded / total) * 100).toFixed(1) : "0.0";
            return `${p} ${excluded}/${total} ${pct}%`;
          })
          .join("   "),
    );
    console.log(`  provider spread: ${providerSpread.toFixed(1)} points`);

    // T-065 clause 3: a provider with rows in the corpus but ZERO surviving
    // (COUNT-eligible) rows is invisible to every table above it — named
    // here so it is invisible to none of them.
    if (fullyExcluded.length > 0) {
      console.log(
        `  fully excluded (0 surviving rows, contribute nothing to any COUNT rate above): ` +
          fullyExcluded.join(", "),
      );
    }

    // T-065 clause 2: for each provider bandStats() found unpaired, say
    // WHICH KIND of absence it is — "no rows in this band" (a scheduling
    // gap) versus "rows exist, all excluded" (a property of that provider,
    // not fixed by sweeping more) look identical in the unpaired list alone.
    if (unpaired.length > 0) {
      console.log(`  unpaired providers, classified:`);
      for (const u of unpaired) {
        const missingBand = u.band === "easy" ? "hard" : "easy";
        const c = classifyAbsence(
          exclusionByProviderBand,
          u.providerId,
          missingBand,
        );
        const desc =
          c.kind === "absent"
            ? "no rows — genuinely absent"
            : `${c.total} row${c.total === 1 ? "" : "s"}, all excluded`;
        console.log(`    ${u.providerId} (${missingBand}): ${desc}`);
      }
    }
  }

  for (const line of formatOutOfRangeSection(
    outOfRangeRows,
    structuredCount,
    MIN_COUNT,
    MAX_COUNT,
  )) {
    console.log(line);
  }

  for (const line of formatWrongBucketSection(wrongRows)) {
    console.log(line);
  }
}

// T-084 clause 4: vision-probe.mjs's own header already argues WRONG is not
// an upload bug — "the model saw *something* and was confidently mistaken
// about it (this is not an upload bug and no upload fix will ever catch
// it)". Puts the two numbers behind that argument where a reader of a
// REPORT (this script's output) sees them, not only where a reader of the
// source does — this board has three tickets (T-011, T-048, T-074) about a
// true sentence in one artefact being unreadable from another. Pure/
// testable for the same reason formatOutOfRangeSection is: the zero-tally
// case needs to print a real "0 of 0", not silently vanish.
export function formatWrongBucketSection(wrongRows) {
  const colorRight = wrongRows.filter((r) => r.colorOk).length;
  const lines = [];
  lines.push(
    `\nWRONG bucket: upload failure, or a model that saw something and got`,
  );
  lines.push(`it wrong? (T-084)`);
  lines.push(
    `  WRONG rows: ${wrongRows.length}   colour named correctly among them: ` +
      `${colorRight}/${wrongRows.length}` +
      (wrongRows.length
        ? `  (${((colorRight / wrongRows.length) * 100).toFixed(1)}%)`
        : ""),
  );
  lines.push(
    `  Cross-reference (T-072): 0 of every informative BLIND turn recorded` +
      ` on this board has ever stated a count at all — a stated count is` +
      ` itself evidence a picture arrived. Together: the WRONG bucket is` +
      ` not an arrival signal in either direction, and most of it carries` +
      ` positive evidence of arrival — a colour named correctly — on the` +
      ` one field it got right while missing the other.`,
  );
  return lines;
}

// T-078: the section T-076 shipped for this could only ever print the NOTE
// about what a zero means from inside `if (outOfRangeRows.length > 0)` —
// exactly backwards, since the reader who most needs "0 here is not
// evidence nobody fabricated, only that nobody fabricated conspicuously"
// is the one running an audit that found zero, and an absent section reads
// as "checked, nothing found" with nothing on screen to say those are
// different claims. Pulled into a pure, return-lines function (rather than
// console.log directly) so the zero-tally case — the one thing a
// print-only version could never pin — is unit-testable without capturing
// stdout. The non-zero branch is untouched line for line from what T-076
// shipped: same strings, same order, same console.log call boundaries, so
// a real corpus's non-zero output is byte-identical to before.
export function formatOutOfRangeSection(
  outOfRangeRows,
  structuredCount,
  minCount,
  maxCount,
) {
  const lines = [];
  if (outOfRangeRows.length > 0) {
    const boundary = outOfRangeRows.filter((r) => r.onBoundary);
    const other = outOfRangeRows.filter((r) => !r.onBoundary);
    lines.push(
      `\nOut-of-range COUNT (generator draws ${minCount}..${maxCount} only) — ` +
        `${outOfRangeRows.length} row${outOfRangeRows.length === 1 ? "" : "s"}:`,
    );
    lines.push(
      `  boundary miscount (said ${maxCount + 1} at truth ${maxCount}, off by one): ${boundary.length}`,
    );
    for (const r of boundary) {
      lines.push(
        `    ${r.file}  ${r.providerId}  truth=${r.truth} said=${r.said}  imageAttached=${r.imageAttached}`,
      );
    }
    lines.push(
      `  below the floor / not adjacent — cannot be a miscount: ${other.length}`,
    );
    for (const r of other) {
      const gap = r.said - r.truth;
      lines.push(
        `    ${r.file}  ${r.providerId}  truth=${r.truth} said=${r.said}  ` +
          `gap=${gap > 0 ? "+" : ""}${gap}  imageAttached=${r.imageAttached}`,
      );
    }
  } else {
    // The line this ticket exists to add: a reader seeing NO section at all
    // (T-076's own version) cannot tell "checked, found nothing" apart from
    // "did not run" — this says which one happened, and by how much: "0 of
    // N" and "0 of 0" are different facts, and structuredCount (the same
    // structured-reply population outOfRangeRows itself is drawn from) is
    // the N that makes that difference visible instead of assumed.
    lines.push(
      `\nOut-of-range COUNT (generator draws ${minCount}..${maxCount} only) — ` +
        `0 of ${structuredCount} structured repl${structuredCount === 1 ? "y" : "ies"} examined:`,
    );
  }
  lines.push(
    `  NOTE: this check is one-directional — out of range proves the reply\n` +
      `  is not a reading of any drawable picture; IN range proves nothing.\n` +
      `  A total of 0 here is not evidence nobody fabricated, only that\n` +
      `  nobody fabricated conspicuously.`,
  );
  return lines;
}

// Guarded (same pattern as vision-probe.mjs, ia-grade.mjs): importing
// auditShapes for a test must not also scan reports/vision-probe and print.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
