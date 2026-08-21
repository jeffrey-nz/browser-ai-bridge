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
import { classify } from "./vision-probe.mjs";

export function auditShapes(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let rowsWithRaw = 0;
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

  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    for (const r of j.results || []) {
      if (r.raw == null) continue;
      rowsWithRaw++;
      storedHistogram[r.shape] = (storedHistogram[r.shape] || 0) + 1;
      const recomputed = classify(r.raw, j.truth);
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

      if (j.truth?.count !== undefined) {
        const cell = (shapeByCount[j.truth.count] ??= {
          total: 0,
          excluded: 0,
        });
        cell.total++;
        if (EXCLUDED_SHAPES.has(recomputed.shape)) cell.excluded++;
      }

      // Same denominator vision-probe.mjs's own summary line uses: the
      // STRUCTURED subset (a row that carried a countOk verdict at all —
      // PASS/COUNT_ONLY/WRONG), keyed by the truth it was actually drawn
      // against.
      if (recomputed.countOk !== undefined && j.truth?.count !== undefined) {
        const bucket = (countStrata[j.truth.count] ??= {
          n: 0,
          ok: 0,
          providers: new Set(),
        });
        bucket.n++;
        bucket.providers.add(r.providerId);
        if (recomputed.countOk) bucket.ok++;

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
    disagreements,
    storedHistogram,
    recomputedHistogram,
    countStrata,
    providerBand,
    shapeByCount,
  };
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

function main() {
  const dir = path.join(process.cwd(), "reports", "vision-probe");
  const {
    rowsWithRaw,
    disagreements,
    storedHistogram,
    recomputedHistogram,
    countStrata,
    providerBand,
    shapeByCount,
  } = auditShapes(dir);

  console.log(
    `rows with raw: ${rowsWithRaw}   disagreements: ${disagreements.length}`,
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

  // T-063: the pooled 3-5/6-9 line alone hides that the provider SET differs
  // between the two bands — see bandStats()'s own comment. Print pooled
  // (every row, the number this script always printed) alongside paired
  // (only providers with rows in BOTH bands, the only figure a same-provider
  // comparison actually supports), and name who got left out of paired.
  if (counts.length > 0) {
    const { pooled, paired, pairedCount, unpaired } = bandStats(providerBand);
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
}

// Guarded (same pattern as vision-probe.mjs, ia-grade.mjs): importing
// auditShapes for a test must not also scan reports/vision-probe and print.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
