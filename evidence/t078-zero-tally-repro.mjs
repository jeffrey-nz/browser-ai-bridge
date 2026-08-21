// T-078: reproduces the zero-out-of-range case against a FILTERED COPY of
// the real corpus (excludes the 6 files that carry the boundary-miscount
// rows and the 2 that carry the below-floor rows — the same 8 rows
// evidence/t076-shapeaudit-output.txt's own "Out-of-range COUNT" section
// lists), not a hand-edited real corpus — per the ticket's own
// instruction not to manufacture the case by editing reports/vision-probe
// itself. auditShapes() and formatOutOfRangeSection() are the exact
// functions the real CLI (scripts/shape-audit.mjs's main()) calls; this
// just points auditShapes() at the filtered copy and prints the section
// the same way main() does.
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  auditShapes,
  formatOutOfRangeSection,
} from "../scripts/shape-audit.mjs";
import { MIN_COUNT, COUNT_RANGE } from "../scripts/vision-probe.mjs";

const MAX_COUNT = MIN_COUNT + COUNT_RANGE - 1;
const REAL_DIR = path.join(process.cwd(), "reports", "vision-probe");

// The exact files evidence/t076-shapeaudit-output.txt's own out-of-range
// section names — excluding these and only these removes every
// out-of-range row without touching anything else.
const EXCLUDE_FILES = new Set([
  "t030-mistral-run1.json",
  "t030-mistral-run2.json",
  "t040-post-t039-sweep.json",
  "t050-copilot-count9-run1.json",
  "t050-copilot-count9-run2.json",
  "t045-fix-verify.json",
  "t045-refix-verify2.json",
]);

const dir = mkdtempSync(path.join(tmpdir(), "shape-audit-t078-"));
try {
  const files = fs.readdirSync(REAL_DIR).filter((f) => f.endsWith(".json"));
  let copied = 0;
  for (const f of files) {
    if (EXCLUDE_FILES.has(f)) continue;
    fs.copyFileSync(path.join(REAL_DIR, f), path.join(dir, f));
    copied++;
  }
  console.log(
    `[setup] copied ${copied}/${files.length} report files (excluded ${EXCLUDE_FILES.size} — the exact files evidence/t076-shapeaudit-output.txt's own out-of-range section names)`,
  );

  const { outOfRangeRows, structuredCount } = auditShapes(dir);
  console.log(
    `[measured] outOfRangeRows.length=${outOfRangeRows.length} structuredCount=${structuredCount}`,
  );

  console.log("\n=== formatOutOfRangeSection() output ===");
  for (const line of formatOutOfRangeSection(
    outOfRangeRows,
    structuredCount,
    MIN_COUNT,
    MAX_COUNT,
  )) {
    console.log(line);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
