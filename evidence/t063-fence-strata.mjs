// FENCE -- the count strata pool over a provider set that changes per stratum.
// Self-tests against shape-audit's own published band totals first.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { classify } = await import(
  pathToFileURL(path.join(process.cwd(), "scripts", "vision-probe.mjs")).href
);
const d = path.join(process.cwd(), "reports", "vision-probe");
const band = (c) => (c <= 5 ? "easy" : "hard");

function tally(skip) {
  const P = {}, byCount = {};
  for (const f of fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort()) {
    if (skip && skip(f)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); } catch { continue; }
    if (!j.truth || j.truth.count === undefined) continue;
    for (const r of j.results || []) {
      if (typeof r.raw !== "string") continue;
      const g = classify(r.raw, j.truth);
      if (!["PASS", "COUNT_ONLY", "WRONG"].includes(g.shape)) continue;
      const b = band(j.truth.count);
      ((P[r.providerId] ??= {})[b] ??= { n: 0, ok: 0 });
      P[r.providerId][b].n++;
      if (g.countOk) P[r.providerId][b].ok++;
      (byCount[j.truth.count] ??= { n: 0, ok: 0 }).n++;
      if (g.countOk) byCount[j.truth.count].ok++;
    }
  }
  return { P, byCount };
}

function bands(P, paired) {
  const keys = Object.keys(P).filter((p) => !paired || (P[p].easy && P[p].hard)).sort();
  const e = { n: 0, ok: 0 }, h = { n: 0, ok: 0 }, worse = [];
  for (const p of keys) {
    const a = P[p].easy, b = P[p].hard;
    if (a) { e.n += a.n; e.ok += a.ok; }
    if (b) { h.n += b.n; h.ok += b.ok; }
    if (a && b && b.ok / b.n < a.ok / a.n) worse.push(p + " " + a.ok + "/" + a.n + " -> " + b.ok + "/" + b.n);
  }
  return { keys, e, h, worse };
}

const all = tally(null);
// SELF-TEST: reproduce shape-audit's own band totals before saying anything else.
const pooled = bands(all.P, false);
console.log("self-test vs shape-audit's own bands:");
console.log("  3-5 " + pooled.e.ok + "/" + pooled.e.n + "   6-9 " + pooled.h.ok + "/" + pooled.h.n
  + "   (run `node scripts/shape-audit.mjs` and compare -- they must match)");
console.log("  per-count: " + Object.keys(all.byCount).sort()
  .map((c) => c + ":" + all.byCount[c].ok + "/" + all.byCount[c].n).join("  "));

console.log("\nprovider    easy 3-5        hard 6-9        paired?");
for (const p of Object.keys(all.P).sort()) {
  const a = all.P[p].easy, b = all.P[p].hard;
  const f = (v) => (v ? (100 * v.ok / v.n).toFixed(0) + "% (" + v.ok + "/" + v.n + ")" : "-- absent --");
  console.log("  " + p.padEnd(11) + f(a).padEnd(16) + f(b).padEnd(16) + (a && b ? "yes" : "NO"));
}

for (const [label, skip] of [["all rows", null], ["T-050's own rows held out", (f) => f.startsWith("t050-")]]) {
  const { P } = tally(skip);
  const r = bands(P, true);
  console.log("\n" + label + ":");
  console.log("  paired providers " + r.keys.length + " (" + r.keys.join(",") + ")");
  console.log("  easy 3-5 " + r.e.ok + "/" + r.e.n + " " + (100 * r.e.ok / r.e.n).toFixed(1) + "%"
    + "   hard 6-9 " + r.h.ok + "/" + r.h.n + " " + (100 * r.h.ok / r.h.n).toFixed(1) + "%");
  console.log("  worse in the hard band: " + r.worse.length + "   " + r.worse.join(" | "));
}

const unpaired = Object.keys(all.P).filter((p) => !(all.P[p].easy && all.P[p].hard));
console.log("\nproviders pooled into the printed rate that cannot be paired: "
  + unpaired.length + " (" + unpaired.join(",") + ")");
process.exit(unpaired.length ? 1 : 0);
