// FENCE -- a provider with rows in the corpus must appear SOMEWHERE in
// shape-audit.mjs's own printed output. Self-tests against shape-audit's
// own overall exclusion figure first.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const { classify } = await import(
  pathToFileURL(path.join(process.cwd(), "scripts", "vision-probe.mjs")).href
);
const d = path.join(process.cwd(), "reports", "vision-probe");
const EXCLUDED = new Set(["SEES_NO", "ECHO", "NO_ANSWER"]);

const providers = {};
let totalAll = 0,
  excludedAll = 0;
for (const f of fs
  .readdirSync(d)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
  } catch {
    continue;
  }
  for (const r of j.results || []) {
    if (r.raw == null) continue;
    const g = classify(r.raw, j.truth);
    const isExcluded = EXCLUDED.has(g.shape);
    totalAll++;
    if (isExcluded) excludedAll++;
    const p = (providers[r.providerId] ??= { total: 0, excluded: 0 });
    p.total++;
    if (isExcluded) p.excluded++;
  }
}

// SELF-TEST: reproduce shape-audit's own overall exclusion figure first.
const overall = (excludedAll / totalAll) * 100;
console.log("self-test vs shape-audit's own overall exclusion figure:");
console.log(
  `  ${excludedAll}/${totalAll} excluded  ${overall.toFixed(1)}%   ` +
    `(run \`node scripts/shape-audit.mjs\` and compare its "overall:" line -- they must match)`,
);

console.log("\nper-provider (rows with raw, all counts pooled):");
for (const p of Object.keys(providers).sort()) {
  const { total, excluded } = providers[p];
  const pct = total > 0 ? ((excluded / total) * 100).toFixed(1) : "0.0";
  console.log(`  ${p.padEnd(11)} ${excluded}/${total} excluded  ${pct}%`);
}

const auditOutput = execSync("node scripts/shape-audit.mjs", {
  cwd: process.cwd(),
  encoding: "utf8",
});

const invisible = Object.keys(providers).filter(
  (p) => !auditOutput.includes(p),
);

console.log(
  "\nproviders with rows in the corpus that appear NOWHERE in " +
    "`node scripts/shape-audit.mjs`'s own output: " +
    (invisible.length ? invisible.join(", ") : "(none)"),
);

process.exit(invisible.length ? 1 : 0);
