import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T-094: ia-grade.mjs section 3 divided a plant-EXCLUDING numerator
// (`refutable`, T-053) by a plant-INCLUDING denominator (`cell(false, ()
// => true)` — every imageAttached=false row, planted ones still inside
// it). The printed "naturally-occurring" rate fell every time the board
// planted a deliberate break, for a reason the line never stated — the
// true naturally-occurring denominator never moved. Runs the REAL script
// as a subprocess against a constructed fixture corpus (ia-grade.mjs's
// own `reports/vision-probe` path is a fixed relative path off cwd, not
// parameterised, so this is the only way to drive its full printed
// output rather than a pulled-out fragment) and asserts the printed
// NUMBER, not the presence of the word "planted".
function repoRoot() {
  return new URL("..", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  );
}

function writeReport(dir, name, { count, color, results }) {
  writeFileSync(
    join(dir, name),
    JSON.stringify({ truth: { count, color }, results }),
  );
}

test("ia-grade.mjs section 3: naturally-occurring denominator excludes planted rows (2 natural, 3 planted, 43 natural false total)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ia-grade-section3-test-"));
  const reportsDir = join(cwd, "reports", "vision-probe");
  mkdirSync(reportsDir, { recursive: true });
  try {
    // 2 natural refutable rows: imageAttached=false, but the reply states
    // the correct COUNT anyway — the only shape that can ever contradict
    // the flag.
    writeReport(reportsDir, "natural-refutable-1.json", {
      count: 4,
      color: "teal",
      results: [
        {
          providerId: "a",
          raw: "SEES=yes COUNT=4 COLOR=teal",
          imageAttached: false,
        },
      ],
    });
    writeReport(reportsDir, "natural-refutable-2.json", {
      count: 5,
      color: "indigo",
      results: [
        {
          providerId: "b",
          raw: "SEES=yes COUNT=5 COLOR=indigo",
          imageAttached: false,
        },
      ],
    });
    // 41 more natural, non-refutable false rows (SEES=no) — brings the
    // natural false total to 43 (2 refutable + 41 non-refutable), the
    // acceptance's own reference denominator.
    for (let i = 0; i < 41; i++) {
      writeReport(reportsDir, `natural-seesno-${i}.json`, {
        count: 3,
        color: "crimson",
        results: [
          { providerId: `n${i}`, raw: "SEES=no", imageAttached: false },
        ],
      });
    }
    // 3 planted rows — imageAttached=false, correct count stated, but
    // marked with a top-level plantedBreak field (T-053's own shape).
    for (let i = 0; i < 3; i++) {
      writeReport(reportsDir, `planted-${i}.json`, {
        count: 6,
        color: "goldenrod",
        results: [
          {
            providerId: `p${i}`,
            raw: "SEES=yes COUNT=6 COLOR=goldenrod",
            imageAttached: false,
          },
        ],
      });
      // plantedBreak is a FILE-level field, not per-result — rewrite with it.
      const path = join(reportsDir, `planted-${i}.json`);
      const j = JSON.parse(readFileSync(path, "utf8"));
      j.plantedBreak = `test plant ${i}`;
      writeFileSync(path, JSON.stringify(j));
    }

    const output = execFileSync(
      "node",
      [join(repoRoot(), "scripts", "ia-grade.mjs")],
      { cwd, encoding: "utf8" },
    );

    // THE ASSERTION THIS TICKET IS ABOUT: the denominator must read 43
    // (2 natural refutable + 41 natural non-refutable), not 46 (+ the 3
    // planted rows folded in) — asserted against the actual printed
    // number, not just the word "planted" appearing somewhere.
    assert.match(
      output,
      /imageAttached=false turns that state a COUNT at all: 2 naturally-occurring of 43 \(\+ 3 planted, listed separately\)/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
