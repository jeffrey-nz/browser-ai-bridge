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
      const recomputedShape = classify(r.raw, j.truth).shape;
      recomputedHistogram[recomputedShape] =
        (recomputedHistogram[recomputedShape] || 0) + 1;
      if (recomputedShape !== r.shape) {
        disagreements.push({
          file: f,
          providerId: r.providerId,
          storedShape: r.shape,
          recomputedShape,
        });
      }
    }
  }

  return { rowsWithRaw, disagreements, storedHistogram, recomputedHistogram };
}

function main() {
  const dir = path.join(process.cwd(), "reports", "vision-probe");
  const { rowsWithRaw, disagreements, storedHistogram, recomputedHistogram } =
    auditShapes(dir);

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
}

// Guarded (same pattern as vision-probe.mjs, ia-grade.mjs): importing
// auditShapes for a test must not also scan reports/vision-probe and print.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
