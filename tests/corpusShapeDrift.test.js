import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../scripts/vision-probe.mjs";

// T-056: `shape` stored in a report row is a measurement taken once, by
// whatever classify() said the day it was written (shape-audit.mjs's own
// T-027 policy). This repo has settled that RAW + TRUTH is the
// authoritative reading and a stored `shape` is a historical cache any
// reader may ignore — every tally on this board (ia-grade.mjs,
// shape-audit.mjs) already recomputes from raw rather than trusting the
// stored field; this test is that same rule made enforceable instead of
// merely conventional.
//
// A reader of a row is entitled to assume: `shape` describes what SOME
// past classify() said, not what today's does. If you need "is this row
// right by today's rules", recompute it — the row itself does not promise
// that answer.
//
// KNOWN DRIFT, explained rather than silently tolerated (clause 1). Six
// rows in the committed corpus carry a stored shape that today's
// classify() contradicts on the same raw + truth. Re-run the scan in this
// ticket's own goal section for the live count; it was 156 rows / 6
// disagreements the day this test was written, and any further growth of
// the corpus is expected to leave this exact set of 6 UNCHANGED (T-056's
// log confirms this: the same 6, byte for byte, across three separate
// re-derivations spanning +64 new rows).
//
//   after-ask.json / result-ask-qwen.json (mistral/qwen, SEES_NO -> ECHO):
//     T-025 (b6c77c4) replaced ia-grade.mjs's own hand-typed echo regex
//     with classify()'s own detection — these two rows were graded before
//     that fix existed, by whatever produced their `shape` originally
//     (both files predate the provenance fields every later report
//     carries at all, so neither was graded by today's classify()).
//
//   run-1787282676781.json (gemini/grok/copilot) and run-1787282393215.json
//   (zai), WRONG -> COUNT_ONLY:
//     T-012 (651eab4) is the commit that split "count right, colour
//     off-list" out of the generic WRONG bucket into its own COUNT_ONLY
//     shape. Both files have the oldest schema in this corpus (endpoint/
//     truth/imagePath/results only — no gradedAt, no bridgeCommit, none
//     of the provenance fields every later ticket added), consistent with
//     having been graded before T-012's classify() existed: a count-right
//     reply whose colour word was off the palette (all four raws say
//     "COLOR=yellow", not in COLORS) had nowhere to land but WRONG at the
//     time.
//
// NOT REWRITTEN (clause 4, T-027's own policy): none of the 6 rows' stored
// `shape` fields are touched by this ticket or this test. A row rewritten
// to agree with the code that reads it can never disagree with it again —
// this test's whole value is noticing if that ever happens by accident.
const KNOWN_DRIFT = new Set([
  "after-ask.json|mistral|SEES_NO|ECHO",
  "result-ask-qwen.json|qwen|SEES_NO|ECHO",
  "run-1787282393215.json|zai|WRONG|COUNT_ONLY",
  "run-1787282676781.json|gemini|WRONG|COUNT_ONLY",
  "run-1787282676781.json|grok|WRONG|COUNT_ONLY",
  "run-1787282676781.json|copilot|WRONG|COUNT_ONLY",
]);

const REPORTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "reports",
  "vision-probe",
);

function scanForDrift(dir) {
  const drift = [];
  let total = 0;
  for (const f of fs
    .readdirSync(dir)
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    for (const r of j.results || []) {
      if (typeof r.raw !== "string" || !r.shape) continue;
      total++;
      const now = classify(r.raw, j.truth || {}).shape;
      if (now !== r.shape) {
        drift.push({
          key: `${f}|${r.providerId}|${r.shape}|${now}`,
          f,
          providerId: r.providerId,
          recorded: r.shape,
          now,
        });
      }
    }
  }
  return { total, drift };
}

test.describe("corpus shape drift (T-056)", () => {
  test("every disagreement between a stored shape and today's classify() is a KNOWN, explained one", () => {
    const { drift } = scanForDrift(REPORTS_DIR);
    const unexplained = drift.filter((d) => !KNOWN_DRIFT.has(d.key));
    assert.deepEqual(
      unexplained,
      [],
      "A NEW disagreement appeared between a stored shape and today's " +
        "classify() that is not in this test's KNOWN_DRIFT list. This is " +
        "either a live grading fault (investigate before anything else) " +
        "or a genuine, explainable drift like T-056's own 6 (find the " +
        "commit that changed classify()'s behaviour, per T-056 clause 1, " +
        "and add the row to KNOWN_DRIFT with that explanation — do NOT " +
        "just add the key without the reasoning, and do NOT rewrite the " +
        "row's stored shape to make this test pass).",
    );
  });

  // The other direction matters too: if one of the 6 known rows stops
  // disagreeing (e.g. because someone backfilled its stored shape, which
  // T-027/clause 4 forbid), that is worth knowing rather than silently
  // shrinking the known-drift set.
  test("none of the 6 known-drift rows have silently stopped disagreeing", () => {
    const { drift } = scanForDrift(REPORTS_DIR);
    const stillDrifting = new Set(drift.map((d) => d.key));
    const vanished = [...KNOWN_DRIFT].filter((k) => !stillDrifting.has(k));
    assert.deepEqual(
      vanished,
      [],
      "A row in KNOWN_DRIFT no longer disagrees with classify() — its " +
        "stored shape may have been backfilled (T-027/T-056 clause 4 " +
        "forbid this) or the file may have been altered or removed. " +
        "Investigate before removing it from KNOWN_DRIFT.",
    );
  });
});
