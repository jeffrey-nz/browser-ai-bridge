import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T-099: T-096's merged per-provider block read `.standardized` off
// computeStandardizedRates() and threw away `.weightCovered`/`.strataHeld` —
// the numbers that say whether a standardised rate is worth trusting. A
// provider standardised over 2 of 7 strata (28.0% of corpus weight) printed
// with no coverage figure beside it, indistinguishable on the page from one
// covering all 7. Runs the real script as a subprocess against a
// constructed fixture (shape-audit.mjs's own reports dir is a fixed
// relative path off cwd, not parameterised) and asserts on the FORMATTED
// ROW text, not the numbers behind it — so deleting the print (the actual
// failure mode this ticket is about) is what breaks this test, not a
// change to the underlying computation.
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

test("shape-audit.mjs per-provider block prints weight-covered and strata-shown beside BOTH standardised figures, and flags a thin-coverage row", () => {
  const cwd = mkdtempSync(join(tmpdir(), "shape-audit-coverage-test-"));
  const reportsDir = join(cwd, "reports", "vision-probe");
  mkdirSync(reportsDir, { recursive: true });
  try {
    // "full" answers correctly at every one of the 7 strata (3..9) — full
    // coverage, 100% weight, 7/7 strata.
    const counts = [3, 4, 5, 6, 7, 8];
    for (const c of counts) {
      writeReport(reportsDir, `full-${c}.json`, {
        count: c,
        color: "teal",
        results: [
          {
            providerId: "full",
            raw: `SEES=yes COUNT=${c} COLOR=teal`,
            imageAttached: true,
          },
        ],
      });
    }
    // count=9 carries TWO rows — "full"'s own (completing its 7/7) and
    // "thin"'s only row. countStrata[9].n = 2, totalN = 8 (6 singles + 2 at
    // count 9), so count 9's own weight share is 2/8 = 25% — "thin" is
    // standardised entirely over that one stratum, at 25.0% corpus weight,
    // well under the 50% *THIN* threshold.
    writeReport(reportsDir, "count9.json", {
      count: 9,
      color: "teal",
      results: [
        {
          providerId: "full",
          raw: "SEES=yes COUNT=9 COLOR=teal",
          imageAttached: true,
        },
        {
          providerId: "thin",
          raw: "SEES=yes COUNT=9 COLOR=teal",
          imageAttached: true,
        },
      ],
    });

    const output = execFileSync(
      "node",
      [join(repoRoot(), "scripts", "shape-audit.mjs")],
      { cwd, encoding: "utf8" },
    );

    // "full": 100% standardised, 100.0% weight covered, all 7 strata.
    const fullLine = output
      .split("\n")
      .find((l) => l.trim().startsWith("full ") && l.includes("graded"));
    assert.ok(fullLine, `no "full" row found in output:\n${output}`);
    assert.match(fullLine, /weight 100\.0%/);
    assert.match(fullLine, /strata 7\/7/);
    assert.ok(
      !fullLine.includes("*THIN*"),
      `"full" (100% coverage) should not be flagged THIN: ${fullLine}`,
    );

    // "thin": standardised over 1 of 7 strata, 25.0% of corpus weight —
    // the exact shape this ticket is about, flagged as such.
    const thinLine = output
      .split("\n")
      .find((l) => l.trim().startsWith("thin ") && l.includes("graded"));
    assert.ok(thinLine, `no "thin" row found in output:\n${output}`);
    assert.match(thinLine, /weight 25\.0%/);
    assert.match(thinLine, /strata 1\/7/);
    assert.ok(
      thinLine.includes("*THIN*"),
      `"thin" (25% coverage) should be flagged THIN: ${thinLine}`,
    );

    // The legend/summary line names the thin provider explicitly, not only
    // a marker a reader could scroll past.
    assert.match(output, /\*THIN\*: thin —/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
