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

test("ia-grade.mjs section 3: naturally-occurring and planted denominators are a real partition of section 4's total, even when a planted row states no COUNT", () => {
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
    // 3 planted rows that state a COUNT — imageAttached=false, correct
    // count stated, marked with a top-level plantedBreak field (T-053's
    // own shape).
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
    // T-094 REDO: a 4th planted row that states NO count at all (the shape
    // T-094's own review found already on disk — chatgpt's plantedBreak
    // row is a bare "SEES=no"). This row never enters `refutableAll`
    // (said === null), so it can never land in `planted`, but it is still
    // an imageAttached=false row with plantedBreak set — the first fix
    // attempt's naturalFalseCount excluded it from the natural denominator
    // without it ever reaching the planted side either, silently losing a
    // row (naturalFalseCount + planted.length stopped summing to the
    // section-4 total). Without this row the arithmetic bug is invisible:
    // this is exactly the shape that let a green test sit next to a line
    // that could not add up.
    writeReport(reportsDir, "planted-no-count.json", {
      count: 6,
      color: "goldenrod",
      results: [{ providerId: "p3", raw: "SEES=no", imageAttached: false }],
    });
    {
      const path = join(reportsDir, "planted-no-count.json");
      const j = JSON.parse(readFileSync(path, "utf8"));
      j.plantedBreak = "test plant 3 (no count stated)";
      writeFileSync(path, JSON.stringify(j));
    }

    const output = execFileSync(
      "node",
      [join(repoRoot(), "scripts", "ia-grade.mjs")],
      { cwd, encoding: "utf8" },
    );

    // THE ASSERTION THIS TICKET IS ABOUT: naturally-occurring reads 2 of 43
    // (2 natural refutable + 41 natural non-refutable) and planted reads 3
    // of 4 (3 that state a count + 1 that doesn't) — asserted against the
    // actual printed numbers, not just the word "planted" appearing
    // somewhere. And the two denominators must RECONCILE: 43 + 4 = 47, the
    // same total section 4 reports independently for this fixture.
    const match = output.match(
      /imageAttached=false turns that state a COUNT at all: (\d+) of (\d+) naturally-occurring \(\+ (\d+) of (\d+) planted, listed separately\)/,
    );
    assert.ok(match, `section 3 line not found in output:\n${output}`);
    const [, refutableCount, naturalTotal, plantedRefutable, plantedTotal] =
      match.map(Number);
    assert.equal(refutableCount, 2);
    assert.equal(naturalTotal, 43);
    assert.equal(plantedRefutable, 3);
    assert.equal(plantedTotal, 4);

    const section4Match = output.match(/(\d+) imageAttached=false rows/);
    assert.ok(section4Match, `section 4 total not found in output:\n${output}`);
    const section4Total = Number(section4Match[1]);
    assert.equal(
      naturalTotal + plantedTotal,
      section4Total,
      "naturally-occurring + planted denominators must sum to section 4's own total",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
