#!/usr/bin/env node
// Provenance census of reports/vision-probe/ — how much of the corpus can name
// the code that produced it, and where the POSITIVE CONTROLS sit.
// Run from the browser-ai-bridge checkout root:  node <this-file>
//
// TRACKED FILES ONLY (git ls-files). An untracked report is not what a clone
// gets (lessons/what-a-clone-gets.md); two such files existed at f293d11 when
// this was first run and they are `verified`, so including them would have
// flattered the one stratum this probe is about.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Imported from the checkout's OWN ia-grade.mjs, not a second copy of its
// grading rule — same reason ia-grade imports classify() from vision-probe.mjs
// rather than re-implementing it. Resolved against cwd, so this behaves the
// same wherever the file is saved.
const { gradeReply } = await import(
  pathToFileURL(path.resolve("scripts/ia-grade.mjs")).href
);

const DIR = "reports/vision-probe";
const tracked = execSync(`git ls-files ${DIR}`, { encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s.endsWith(".json"))
  .map((s) => path.basename(s))
  .sort();
const trackedSet = new Set(tracked);
const untracked = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".json") && !trackedSet.has(f));

const provOf = (j) =>
  "serverProvenance" in j ? String(j.serverProvenance) : "KEY-ABSENT";
const ORDER = [
  "verified",
  "stale-confirmed",
  "unverifiable",
  "stale-ambiguous",
  "KEY-ABSENT",
];

const files = {},
  rows = {},
  single = {},
  planted = {},
  bucket = {};
const refutableRows = [],
  plantFiles = [];
for (const f of tracked) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  } catch {
    continue;
  }
  const p = provOf(j);
  const n = (j.results || []).length;
  files[p] = (files[p] || 0) + 1;
  rows[p] = (rows[p] || 0) + n;
  if (n === 1) single[p] = (single[p] || 0) + 1;
  if (j.plantedBreak) {
    planted[p] = (planted[p] || 0) + 1;
    plantFiles.push({ f, p, stale: j.serverStale, dirty: j.serverTreeDirty });
  }
  if (j.blind === true) continue;
  bucket[p] = bucket[p] || {
    confirmed: 0,
    refutable: 0,
    neither: 0,
    graded: 0,
  };
  for (const r of j.results || []) {
    // Same admission gate ia-grade uses: a row with no boolean imageAttached
    // is not graded by it either.
    if (r.imageAttached !== true && r.imageAttached !== false) continue;
    const g = gradeReply(r.raw, j.truth);
    bucket[p].graded++;
    if (r.imageAttached === true && g.said != null && g.said === j.truth?.count)
      bucket[p].confirmed++;
    else if (r.imageAttached === false && g.said != null) {
      bucket[p].refutable++;
      refutableRows.push({
        f,
        p,
        pid: r.providerId,
        planted: !!j.plantedBreak,
      });
    } else bucket[p].neither++;
  }
}

console.log(
  `tracked report json in ${DIR}: ${tracked.length}   (untracked, EXCLUDED: ${untracked.length}${untracked.length ? " — " + untracked.join(", ") : ""})`,
);
console.log("");
console.log(
  "stratum".padEnd(22) +
    "files".padStart(6) +
    "rows".padStart(6) +
    "1-prov".padStart(8) +
    "planted".padStart(9) +
    "graded".padStart(8) +
    "CONF".padStart(6) +
    "REFUT".padStart(7) +
    "NEITH".padStart(7),
);
const tot = {
  files: 0,
  rows: 0,
  single: 0,
  planted: 0,
  graded: 0,
  confirmed: 0,
  refutable: 0,
  neither: 0,
};
for (const p of ORDER) {
  if (!files[p]) continue;
  const b = bucket[p] || { confirmed: 0, refutable: 0, neither: 0, graded: 0 };
  console.log(
    p.padEnd(22) +
      String(files[p]).padStart(6) +
      String(rows[p]).padStart(6) +
      String(single[p] || 0).padStart(8) +
      String(planted[p] || 0).padStart(9) +
      String(b.graded).padStart(8) +
      String(b.confirmed).padStart(6) +
      String(b.refutable).padStart(7) +
      String(b.neither).padStart(7),
  );
  tot.files += files[p];
  tot.rows += rows[p];
  tot.single += single[p] || 0;
  tot.planted += planted[p] || 0;
  tot.graded += b.graded;
  tot.confirmed += b.confirmed;
  tot.refutable += b.refutable;
  tot.neither += b.neither;
}
console.log(
  "TOTAL".padEnd(22) +
    String(tot.files).padStart(6) +
    String(tot.rows).padStart(6) +
    String(tot.single).padStart(8) +
    String(tot.planted).padStart(9) +
    String(tot.graded).padStart(8) +
    String(tot.confirmed).padStart(6) +
    String(tot.refutable).padStart(7) +
    String(tot.neither).padStart(7),
);

console.log(
  "\nEVERY plantedBreak FILE — the positive controls, the instrument's capacity to fail:",
);
for (const x of plantFiles)
  console.log(
    `  ${x.f.padEnd(46)} prov=${String(x.p).padEnd(15)} serverStale=${x.stale} serverTreeDirty=${x.dirty}`,
  );
console.log(
  `  -> in the 'verified' stratum: ${plantFiles.filter((x) => x.p === "verified").length} of ${plantFiles.length}`,
);

console.log("\nia-grade's REFUTABLE DENOMINATOR, row by row, with provenance:");
for (const r of refutableRows)
  console.log(
    `  ${r.f.padEnd(46)} ${String(r.pid).padEnd(10)} ${r.planted ? "PLANTED" : "natural"}  ${r.p}`,
  );
console.log(
  `  -> attributable to a named commit ('verified'): ${refutableRows.filter((r) => r.p === "verified").length} of ${refutableRows.length}`,
);

// Consumer census in Node rather than a shell grep, so it runs the same on
// win32 and posix. Counts LINES mentioning any of the three provenance fields
// in every .js/.mjs/.cjs under src/ scripts/ bin/, excluding the two files
// that WRITE them.
//
// T-135: this walk is NOT filtered to exclude the file you are reading right
// now, even though that file matches its own corpus rule ("every .js/.mjs/
// .cjs under src/ scripts/ bin/") and therefore counts its own regex, its
// own WRITERS entry, and its own report line as consumers. A self-filter
// (`if (rel === SELF_PATH) continue`) was considered and rejected: the
// sibling instance on the mmg board (test/check-comment-addresses.mjs,
// T-235) is the same shape pointed the OTHER way — that gate's own header
// carries a genuinely stale address among its worked examples, and
// excluding its own file would have silently suppressed the one real fault
// it ever found in itself. Filtering a corpus walk to exclude its own
// implementation hides whichever direction that file's own instance of the
// count happens to point, flattering or damning, for good. The fix here is
// PARTITION AND PRINT (clauses 1-2 below), never filter — do not re-add an
// exclusion for this file.
const FIELDS = /serverProvenance|serverStale|serverTreeDirty/;
const WRITERS = new Set([
  path.normalize("scripts/vision-probe.mjs"),
  path.normalize("scripts/serverProvenance.mjs"),
]);
// T-135: the two files this census's own finding is ABOUT — the graders
// that already read `raw`/`shape` off a report and could act on its
// provenance — kept as their own bucket rather than pooled with every other
// scripts/ file, so a grader wiring the field in is visible on its own row
// instead of buried inside "scripts/ generally". Named, not derived from a
// convention, because there is no naming convention that picks these two
// out of scripts/ — see the split below for why that matters.
const GRADERS = new Set([
  path.normalize("scripts/ia-grade.mjs"),
  path.normalize("scripts/shape-audit.mjs"),
]);
// This file's own path, relative to cwd (the header says "run from the
// checkout root") — derived from import.meta.url, not typed as the literal
// "scripts/provenance-census.mjs", so a rename of this file does not leave
// a stale self-share comparison behind.
const SELF_PATH = path.normalize(
  path.relative(process.cwd(), fileURLToPath(import.meta.url)),
);

// T-135 clause 1: the corpus's product/grader/other split — DERIVED from
// each consumer's own path at classification time, not typed as three
// separate totals that could drift from the walk. "product" (src/, bin/)
// is the population T-128/L-029 were actually about; pooling it with
// scripts/ is what let it sit at 0 inside a non-zero 23 unnoticed.
function classifyConsumer(rel) {
  const norm = path.normalize(rel);
  const top = norm.split(path.sep)[0];
  if (top === "src" || top === "bin") return "product";
  if (GRADERS.has(norm)) return "grader";
  return "other";
}

let consumers = 0;
let selfConsumers = 0;
const consumerFiles = [];
const bySplit = { product: 0, grader: 0, other: 0 };
const walk = (d) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) walk(rel);
    else if (
      /\.(js|mjs|cjs)$/.test(e.name) &&
      !WRITERS.has(path.normalize(rel))
    ) {
      const hits = fs
        .readFileSync(rel, "utf8")
        .split("\n")
        .filter((l) => FIELDS.test(l)).length;
      if (hits) {
        consumers += hits;
        bySplit[classifyConsumer(rel)] += hits;
        if (path.normalize(rel) === SELF_PATH) selfConsumers += hits;
        consumerFiles.push(`${rel} (${hits})`);
      }
    }
  }
};
for (const d of ["src", "scripts", "bin"]) walk(d);
console.log(
  `\nlines reading serverProvenance/serverStale/serverTreeDirty under src/ scripts/ bin/, excluding the two writers: ${consumers}` +
    (selfConsumers
      ? ` (${selfConsumers} of them in this file, ${SELF_PATH})`
      : ""),
);
console.log(
  `  product (src/, bin/): ${bySplit.product}   grader (ia-grade.mjs, shape-audit.mjs): ${bySplit.grader}   other (rest of scripts/): ${bySplit.other}`,
);
if (consumerFiles.length) console.log("  " + consumerFiles.join("\n  "));
