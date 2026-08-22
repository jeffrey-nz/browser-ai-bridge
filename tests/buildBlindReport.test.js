import test from "node:test";
import assert from "node:assert/strict";
import { buildBlindReport } from "../scripts/vision-probe.mjs";

// T-090: main() returns into runBlind() BEFORE the pinned/drawn dispatch
// that sets stimulusSource ever runs — so a blind report written after
// T-084 landed the field would otherwise carry no stimulusSource at all,
// reading back through the documented reader rule
// (`report.stimulusSource ?? "unrecorded (pre-T-084)"`) as though it
// predated the field it was written under. buildBlindReport is the exact
// object runBlind() writes to disk; this pins that it self-identifies.
test.describe("buildBlindReport", () => {
  test("writes an explicit stimulusSource, distinguishing a blind report from a pre-T-084 one", () => {
    const provenance = { serverProvenance: "verified", treeDirty: false };
    const opts = { endpoint: "ask" };
    const results = [{ providerId: "gemini", shape: "SEES_NO" }];

    const report = buildBlindReport(provenance, opts, results);

    // THE reader rule this ticket exists to keep correct.
    const read = report.stimulusSource ?? "unrecorded (pre-T-084)";
    assert.equal(read, "blind");
    assert.notEqual(read, "unrecorded (pre-T-084)");
  });

  test("still carries blind:true, and no truth/imagePath/fixtureSha256 (T-072's own precedent, unchanged)", () => {
    const report = buildBlindReport({}, { endpoint: "ask" }, []);
    assert.equal(report.blind, true);
    assert.equal("truth" in report, false);
    assert.equal("imagePath" in report, false);
    assert.equal("fixtureSha256" in report, false);
  });

  test("carries provenance and results through unchanged", () => {
    const provenance = { serverProvenance: "verified", serverTreeDirty: true };
    const results = [{ providerId: "a" }, { providerId: "b" }];
    const report = buildBlindReport(provenance, { endpoint: "ask" }, results);
    assert.equal(report.serverProvenance, "verified");
    assert.equal(report.serverTreeDirty, true);
    assert.deepEqual(report.results, results);
    assert.equal(report.endpoint, "ask");
  });
});
