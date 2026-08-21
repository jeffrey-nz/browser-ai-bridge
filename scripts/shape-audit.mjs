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
    exclusionByProviderBand,
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
    exclusionByProviderBand,
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
}

// Guarded (same pattern as vision-probe.mjs, ia-grade.mjs): importing
// auditShapes for a test must not also scan reports/vision-probe and print.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
