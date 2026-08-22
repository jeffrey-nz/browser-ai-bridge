import { test } from "node:test";
import assert from "node:assert/strict";
import { extractServerProvenance } from "../scripts/serverProvenance.mjs";
import { buildPingASummary } from "../evidence/t075-repro.mjs";
import { buildRecord } from "../evidence/t079-askall-deepseek.mjs";
import { buildStatusLine } from "../evidence/t071-clause2-probe.mjs";

// T-095: extractServerProvenance()/fetchServerProvenance() already knew the
// difference between "field absent" and "field null" (T-083,
// tests/serverProvenance.test.js) — this pins the SHAPE THAT ACTUALLY GETS
// WRITTEN/PRINTED by each evidence caller, which is a different guarantee:
// a caller can still pick two bare values back out of a correct helper
// return and drop fieldsPresent on the floor, exactly what all three
// callers did before this ticket. A stub ping missing loadedTreeDirty
// entirely must still read as absent (fieldsPresent.loadedTreeDirty ===
// false), not collapse into the same shape a value of `null` would produce.

const PING_MISSING_TREE_DIRTY = { loadedCommit: "abc1234" };
const PING_EXPLICIT_NULL = { loadedCommit: "abc1234", loadedTreeDirty: null };

test("t075-repro.mjs buildPingASummary: a missing loadedTreeDirty reads as absent, not merely null", () => {
  const provenanceMissing = extractServerProvenance(PING_MISSING_TREE_DIRTY);
  const summaryMissing = buildPingASummary({ status: "ok" }, provenanceMissing);
  assert.equal(summaryMissing.loadedTreeDirty, null);
  assert.equal(summaryMissing.fieldsPresent.loadedTreeDirty, false);

  const provenanceExplicitNull = extractServerProvenance(PING_EXPLICIT_NULL);
  const summaryExplicitNull = buildPingASummary(
    { status: "ok" },
    provenanceExplicitNull,
  );
  assert.equal(summaryExplicitNull.loadedTreeDirty, null);
  // The whole point of fieldsPresent: this ping DID send the key (as an
  // explicit null-typed value, which extractServerProvenance still treats
  // as "not the expected boolean" — see its own type guard), and the
  // written record must not read identically to the missing-key case above.
  assert.notDeepEqual(summaryMissing, summaryExplicitNull);
});

test("t079-askall-deepseek.mjs buildRecord: a missing loadedTreeDirty reads as absent in the committed record", () => {
  const provenance = {
    reachable: true,
    ...extractServerProvenance(PING_MISSING_TREE_DIRTY),
  };
  const record = buildRecord({
    bridgeCommit: null,
    provenance,
    truth: { count: 4, color: "goldenrod" },
    fixtureSha256: "deadbeef",
    httpStatus: 200,
    elapsedMs: 1000,
    raw: {},
  });
  assert.equal(record.serverProvenance.loadedTreeDirty, null);
  assert.equal(record.serverProvenance.fieldsPresent.loadedTreeDirty, false);
});

test("t071-clause2-probe.mjs buildStatusLine: a missing loadedTreeDirty reads as absent in the printed line", () => {
  const provenance = {
    reachable: true,
    ...extractServerProvenance(PING_MISSING_TREE_DIRTY),
  };
  const line = buildStatusLine(provenance, { rateLimited: false });
  assert.equal(line.serverProvenance.loadedTreeDirty, null);
  assert.equal(line.serverProvenance.fieldsPresent.loadedTreeDirty, false);
});
