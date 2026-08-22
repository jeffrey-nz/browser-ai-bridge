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
import { pathToFileURL } from "node:url";

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
const FIELDS = /serverProvenance|serverStale|serverTreeDirty/;
const WRITERS = new Set([
  path.normalize("scripts/vision-probe.mjs"),
  path.normalize("scripts/serverProvenance.mjs"),
]);
let consumers = 0;
const consumerFiles = [];
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
        consumerFiles.push(`${rel} (${hits})`);
      }
    }
  }
};
for (const d of ["src", "scripts", "bin"]) walk(d);
console.log(
  `\nlines reading serverProvenance/serverStale/serverTreeDirty under src/ scripts/ bin/, excluding the two writers: ${consumers}`,
);
if (consumerFiles.length) console.log("  " + consumerFiles.join("\n  "));
