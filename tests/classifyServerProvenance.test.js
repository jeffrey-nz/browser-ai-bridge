import test from "node:test";
import assert from "node:assert/strict";
import { classifyServerProvenance } from "../scripts/vision-probe.mjs";

// T-052: compareServerCommit alone conflates two opposite failures in the
// ordinary edit-restart-commit loop — a stale sha that is actually a false
// alarm (server started dirty, then the edits got committed), and a
// matching sha that is actually a lie (server started dirty and nothing
// was ever committed). classifyServerProvenance folds serverStale and
// serverTreeDirty (both tri-state: null/true/false) into the six-way
// verdict the reader-contract comment above gradingProvenance() documents.
test.describe("classifyServerProvenance", () => {
  test("serverStale null is unmeasured regardless of tree state", () => {
    assert.equal(classifyServerProvenance(null, true), "unmeasured");
    assert.equal(classifyServerProvenance(null, false), "unmeasured");
    assert.equal(classifyServerProvenance(null, null), "unmeasured");
  });

  test("stale + clean startup is confirmed stale, no ambiguity", () => {
    assert.equal(classifyServerProvenance(true, false), "stale-confirmed");
  });

  test("stale + dirty startup is the false-alarm shape", () => {
    assert.equal(classifyServerProvenance(true, true), "stale-ambiguous");
  });

  test("stale + unmeasured tree state cannot rule the ambiguous case out", () => {
    assert.equal(classifyServerProvenance(true, null), "stale-unmeasured-tree");
  });

  test("matching sha + clean startup is genuinely verified", () => {
    assert.equal(classifyServerProvenance(false, false), "verified");
  });

  test("matching sha + dirty startup is the silent-lie shape", () => {
    assert.equal(classifyServerProvenance(false, true), "unverifiable");
  });

  test("matching sha + unmeasured tree state cannot rule the silent lie out", () => {
    assert.equal(
      classifyServerProvenance(false, null),
      "verified-unmeasured-tree",
    );
  });
});
