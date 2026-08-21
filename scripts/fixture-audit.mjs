#!/usr/bin/env node
/**
 * fixture-audit.mjs — T-026. Reads every vision-probe fixture PNG still on
 * disk and checks it against the `truth` recorded beside it in its run
 * json: exactly `truth.count` solid-colour connected components of exactly
 * `COLORS[truth.color]`, each one exactly SQUARE x SQUARE pixels with no
 * clipping. This is the pixel-level check nothing else in the repo makes —
 * ia-grade.mjs and classify() only look at what the MODEL said, never at
 * whether the fixture itself was drawn correctly.
 *
 * Imports COLORS/SQUARE from vision-probe.mjs rather than re-typing them —
 * this ticket exists because the count range and the canvas geometry were
 * never joined, so this script is not going to repeat that.
 *
 * Usage: node scripts/fixture-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { COLORS, SQUARE } from "./vision-probe.mjs";
import { decodePng, findComponents, isSolidSquare } from "./pngPixels.mjs";

const dir = path.join(process.cwd(), "reports", "vision-probe");

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

// One entry per distinct image path — several run jsons can cite the same
// fixture (vision-probe.mjs's --image/--count/--color reuse, for parallel
// single-provider runs against one picture). First json to mention a path
// supplies the truth every other citer is assumed to share.
const images = new Map(); // imagePath -> { truth, citedBy: [file,...] }
for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  } catch {
    continue;
  }
  if (!j.imagePath || !j.truth) continue;
  const abs = path.join(process.cwd(), j.imagePath);
  if (!images.has(abs)) images.set(abs, { truth: j.truth, citedBy: [] });
  images.get(abs).citedBy.push(f);
}

let clean = 0;
const bad = [];
let missing = 0;
for (const [imgPath, { truth, citedBy }] of images) {
  if (!fs.existsSync(imgPath)) {
    missing++;
    console.log(
      `MISSING  ${path.basename(imgPath)}  (cited by ${citedBy.join(", ")}) — not on disk, skipped`,
    );
    continue;
  }
  const rgb = COLORS[truth.color];
  if (!rgb) {
    bad.push({
      file: path.basename(imgPath),
      citedBy,
      reason: `unknown truth.color "${truth.color}"`,
    });
    continue;
  }
  const decoded = decodePng(fs.readFileSync(imgPath));
  const components = findComponents(decoded, rgb);
  const squares = components.filter((c) => isSolidSquare(c, SQUARE));
  const ok =
    components.length === truth.count && squares.length === truth.count;
  if (ok) {
    clean++;
  } else {
    bad.push({
      file: path.basename(imgPath),
      citedBy,
      reason:
        `truth.count=${truth.count} truth.color=${truth.color} — decoded ${components.length} ` +
        `component(s), ${squares.length} exactly ${SQUARE}x${SQUARE}: ` +
        components
          .map(
            (c) =>
              `${c.maxX - c.minX + 1}x${c.maxY - c.minY + 1}@${c.minX},${c.minY}`,
          )
          .join(" "),
    });
  }
}

console.log(
  `\ndistinct (image, truth) pairs decoded: ${images.size - missing}` +
    (missing ? `  (${missing} missing on disk, skipped)` : ""),
);
console.log(`clean: ${clean}   bad: ${bad.length}`);
if (bad.length) {
  console.log("\nbad fixtures:");
  for (const b of bad) {
    console.log(`  ${b.file}  (cited by ${b.citedBy.join(", ")})`);
    console.log(`    ${b.reason}`);
  }
}
process.exit(bad.length ? 1 : 0);
