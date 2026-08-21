#!/usr/bin/env node
// ia-grade.mjs — the permanent home for imageAttached's REFUTABLE denominator
// (T-017). Run from the browser-ai-bridge checkout: node scripts/ia-grade.mjs
//
// "N agreements, 0 disagreements" is not a meaningful tally on its own — most
// of this flag's recorded corpus (reports/vision-probe/*.json) can only ever
// AGREE with it, never refute it, because the only independent reference this
// probe has for "did the image arrive" is COUNT (T-012's arrival test, never
// stated in the prompt), and most turns' replies never state a count at all
// (a "SEES=no", a prompt echo, a timeout). This script partitions every
// recorded row into three buckets instead of one pass rate:
//   - CONFIRMED   imageAttached=true and the reply's stated COUNT is right —
//                 an agreement resting on an arithmetic reference, not a
//                 coin flip the model could pass by chance alone
//   - REFUTABLE   imageAttached=false but the reply states a COUNT anyway —
//                 the only shape that could ever disagree with the flag
//   - NEITHER     the reply states no COUNT (SEES=no, an echo, a timeout,
//                 garbage) — consistent with both a true and a false flag,
//                 so it is not evidence in either direction and must not be
//                 folded into an "agreement rate"
//
// Whenever this board or a hand-back wants to cite how well imageAttached
// has held up, run this and quote its three numbers — not a single pass
// rate computed over a denominator most of which could never have failed.
//
// SELF-CHECK: "did the reply state a COUNT" must NOT be answered by grepping the
// raw text, because an ECHO reply contains the prompt and the prompt contains the
// literal "COUNT=" and "SEES=no". 4 of 52 rows were echoes on the corpus this
// was written against, and a naive grep scored all four wrongly. The classifier
// takes echoes off the table first.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const dir = "reports/vision-probe";
const BESPOKE = new Set(["chatgpt", "gemini", "deepseek", "grok", "copilot"]);
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const h = crypto.createHash("sha256");
for (const f of files) h.update(fs.readFileSync(path.join(dir, f)));
const ECHO = /FORMAT REQUIREMENT|No text extracted/i;
const rows = [];
for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  } catch {
    continue;
  }
  for (const r of j.results || []) {
    if (r.imageAttached !== true && r.imageAttached !== false) continue; // 29 rows predate 6c46b4f
    const raw = (r.raw || "").replace(/\s+/g, " ").trim();
    const echo = ECHO.test(raw);
    const m = echo ? null : raw.match(/COUNT\s*=\s*(\d+)/i);
    rows.push({
      f,
      p: r.providerId,
      cls: BESPOKE.has(r.providerId) ? "bespoke" : "generic",
      ia: r.imageAttached,
      shape: r.shape,
      raw,
      echo,
      said: m ? Number(m[1]) : null,
      truth: j.truth?.count ?? null,
      right: m && j.truth ? Number(m[1]) === j.truth.count : null,
      seesNo: !echo && !m && /SEES\s*=\s*n/i.test(raw),
    });
  }
}
console.log(
  `corpus  ${files.length} files, sha256-16 ${h.digest("hex").slice(0, 16)}   graded rows ${rows.length}`,
);
console.log(
  `        (reports/ is gitignored: 'git ls-files reports/' returns 0 - working tree only)`,
);

console.log("\n1. PER-TURN MEASUREMENT, OR PER-PROVIDER CONSTANT?");
const byp = {};
// A filename containing "broken" is a deliberately sabotaged control run
// (T-017 clause 1: a real provider's attach path disabled on purpose, on a
// spare bridge instance, to prove the flag CAN move) — real, recorded data,
// but not a naturally-occurring measurement of the flag's own behaviour, so
// it is marked rather than silently pooled into "how the flag behaves".
const isControl = (r) => /broken/i.test(r.f);
for (const r of rows)
  ((byp[r.p] ||= { cls: r.cls, vals: new Set(), n: 0, natural: [] }),
    byp[r.p].vals.add(r.ia),
    byp[r.p].n++,
    isControl(r) || byp[r.p].natural.push(r.ia));
for (const p of Object.keys(byp).sort()) {
  const b = byp[p];
  const controls = b.n - b.natural.length;
  console.log(
    `   ${p.padEnd(11)} ${b.cls.padEnd(8)} imageAttached=${String([...b.vals].join("/")).padEnd(6)} on all ${String(b.n).padStart(2)} of its turns${controls ? `  (${controls} of those a deliberate-breakage control)` : ""}`,
  );
}
const both = Object.entries(byp)
  .filter(([, b]) => b.vals.size > 1)
  .map(([p]) => p);
console.log(
  `   providers taking BOTH values: ${both.length ? both.join(", ") : "(none) - 0 of " + Object.keys(byp).length}`,
);
// Computed, not asserted: majority-vote-per-provider accuracy over the
// NATURAL rows only (deliberate-breakage controls excluded — they exist to
// prove the flag CAN move, not to be predicted by a rule that assumes it
// doesn't; folding them in would silently answer clause 1's own question).
let correct = 0,
  natTotal = 0;
for (const b of Object.values(byp)) {
  if (!b.natural.length) continue;
  const trueCount = b.natural.filter(Boolean).length;
  const majority = trueCount * 2 >= b.natural.length;
  const majorityCount = b.natural.filter((v) => v === majority).length;
  correct += majorityCount;
  natTotal += b.natural.length;
}
console.log(
  `   "predict the flag from the provider id alone" (majority vote per provider, natural rows only) scores ${correct}/${natTotal}`,
);

console.log(
  "\n2. REGRADED AGAINST COUNT (the field the prompt never states; range 3..9, COLORS 4)",
);
const cell = (ia, k) => rows.filter((r) => r.ia === ia && k(r)).length;
console.log(
  '                        COUNT right  COUNT wrong  "SEES=no"  prompt echo  nothing usable',
);
for (const ia of [true, false])
  console.log(
    `   imageAttached=${String(ia).padEnd(5)}       ${String(cell(ia, (r) => r.right === true)).padEnd(12)} ${String(cell(ia, (r) => r.right === false)).padEnd(12)} ${String(cell(ia, (r) => r.seesNo)).padEnd(10)} ${String(cell(ia, (r) => r.echo)).padEnd(12)} ${cell(ia, (r) => !r.echo && !r.seesNo && r.said === null)}`,
  );

const refutable = rows.filter((r) => r.ia === false && r.said !== null);
const confirming = rows.filter((r) => r.ia === true && r.right === true);
console.log(
  `\n3. HOW MANY OF THE ${rows.length} COULD EVER HAVE CONTRADICTED THE FLAG?`,
);
console.log(
  `   imageAttached=false turns that state a COUNT at all: ${refutable.length} of ${cell(false, () => true)}`,
);
for (const r of refutable)
  console.log(
    `     ${r.f.padEnd(28)} ${r.p.padEnd(10)} said=${r.said} truth=${r.truth} right=${r.right} :: ${r.raw.slice(0, 42)}`,
  );
console.log(
  `   -> disagreements: ${refutable.filter((r) => r.right).length} of ${refutable.length} refutable turns`,
);
console.log(
  `   -> agreements resting on an arithmetic reference: ${confirming.length}, every one imageAttached=true`,
);
console.log(
  `   -> turns graded by the model's own testimony about its own input, or by nothing: ${rows.length - confirming.length - refutable.length}`,
);
