import fs from "node:fs";
import path from "node:path";
import { classify, MIN_COUNT, COUNT_RANGE } from "../scripts/vision-probe.mjs";
const MAX = MIN_COUNT + COUNT_RANGE - 1;
const CD = "reports/vision-probe";
const rows = [];
for (const f of fs.readdirSync(CD).filter((x) => x.endsWith(".json"))) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(CD, f), "utf8"));
  } catch {
    continue;
  }
  if (!j.truth || typeof j.truth.count !== "number") continue;
  for (const r of j.results ?? []) {
    if (!r?.providerId) continue;
    const c = classify(r.raw ?? "", j.truth);
    if (!["PASS", "WRONG", "COUNT_ONLY"].includes(c.shape)) continue; // structured only
    const m = /COUNT\s*=\s*(\d+)/i.exec(r.raw ?? "");
    if (!m) continue;
    rows.push({
      f,
      p: r.providerId,
      truth: j.truth.count,
      said: Number(m[1]),
      shape: c.shape,
      ia: r.imageAttached,
      classifyOutOfRange: c.outOfRange ?? false,
    });
  }
}
const oob = rows.filter((r) => r.said < MIN_COUNT || r.said > MAX);
const wrong = rows.filter((r) => r.said !== r.truth);
console.log(
  `generator range: ${MIN_COUNT}..${MAX}  (validateStimulusArgs enforces it on the STIMULUS)`,
);
console.log(`structured replies stating a COUNT              : ${rows.length}`);
console.log(
  `...stating a count the generator cannot draw    : ${oob.length}  ${(
    (100 * oob.length) /
    rows.length
  ).toFixed(1)}%`,
);
console.log(
  `...as a share of every WRONG answer on record   : ${oob.length}/${
    wrong.length
  }  ${((100 * oob.length) / wrong.length).toFixed(1)}%`,
);
for (const r of oob) {
  console.log(
    `   ${r.f.padEnd(40)} ${r.p.padEnd(10)} truth=${r.truth} said=${String(
      r.said,
    ).padStart(2)}` +
      `  gap=${r.said - r.truth > 0 ? "+" : ""}${r.said - r.truth}  ia=${
        r.ia
      }  graded ${r.shape}  classify().outOfRange=${r.classifyOutOfRange}`,
  );
}
const boundary = oob.filter((r) => r.said === MAX + 1 && r.truth === MAX);
console.log(
  `\n  boundary miscount (said ${MAX + 1} at truth ${MAX}, off by one) : ${boundary.length}`,
);
console.log(
  `  below the floor / not adjacent -- cannot be a miscount  : ${
    oob.length - boundary.length
  }`,
);
const disagree = oob.filter((r) => !r.classifyOutOfRange);
console.log(
  `\n  disagreement between fence and classify().outOfRange: ${disagree.length}`,
);
// Exit contract: none. That is clause 4.
