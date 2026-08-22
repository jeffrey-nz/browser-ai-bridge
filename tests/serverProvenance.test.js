import test from "node:test";
import assert from "node:assert/strict";
import {
  extractServerProvenance,
  fetchServerProvenance,
} from "../scripts/serverProvenance.mjs";

// T-083: two evidence scripts written hours apart disagreed on whether
// loadedTreeDirty belongs in a CLAUSE 0 provenance block, because each
// re-implemented the convention from memory and neither's omission could
// be caught by anything but a PM reading the JSON by eye. These tests pin
// that the helper cannot silently drop a field the way that happened —
// a missing field must show up as `fieldsPresent.<name>: false`, not just
// as an absent key or a defaulted value indistinguishable from a real one.
test.describe("extractServerProvenance", () => {
  test("both fields present: read faithfully, fieldsPresent both true", () => {
    const result = extractServerProvenance({
      loadedCommit: "abc123",
      loadedTreeDirty: true,
    });
    assert.equal(result.loadedCommit, "abc123");
    assert.equal(result.loadedTreeDirty, true);
    assert.deepEqual(result.fieldsPresent, {
      loadedCommit: true,
      loadedTreeDirty: true,
    });
  });

  // THE CASE THIS TICKET IS ABOUT: a stub ping response missing
  // loadedTreeDirty (t075-repro.mjs's original shape) must not silently
  // read as "loadedTreeDirty: undefined" or "false" — fieldsPresent must
  // say the server never sent it.
  test("loadedTreeDirty missing from the response: value is null, fieldsPresent SAYS SO", () => {
    const result = extractServerProvenance({ loadedCommit: "abc123" });
    assert.equal(result.loadedCommit, "abc123");
    assert.equal(result.loadedTreeDirty, null);
    assert.deepEqual(result.fieldsPresent, {
      loadedCommit: true,
      loadedTreeDirty: false,
    });
  });

  test("loadedTreeDirty present but false: distinguishable from missing", () => {
    const result = extractServerProvenance({
      loadedCommit: "abc123",
      loadedTreeDirty: false,
    });
    assert.equal(result.loadedTreeDirty, false);
    assert.equal(result.fieldsPresent.loadedTreeDirty, true);
  });

  // "we didn't ask" (no response object at all) vs "the server didn't
  // report it" (a response object missing the key) are different facts —
  // both read loadedTreeDirty as null, but only fetchServerProvenance's
  // own `reachable` flag (tested below) tells them apart; at this layer,
  // null input must not throw and must read as fully absent.
  test("null response (never fetched, or fetch failed): both fields absent, no throw", () => {
    const result = extractServerProvenance(null);
    assert.equal(result.loadedCommit, null);
    assert.equal(result.loadedTreeDirty, null);
    assert.deepEqual(result.fieldsPresent, {
      loadedCommit: false,
      loadedTreeDirty: false,
    });
  });

  test("wrong-typed field (loadedTreeDirty as a string) reads as absent, not coerced", () => {
    const result = extractServerProvenance({ loadedTreeDirty: "true" });
    assert.equal(result.loadedTreeDirty, null);
    // The KEY was present on the response even though the type was wrong —
    // fieldsPresent tracks presence, not validity, so this is still true.
    assert.equal(result.fieldsPresent.loadedTreeDirty, true);
  });
});

test.describe("fetchServerProvenance", () => {
  // "we didn't ask" — the network call itself never got an answer.
  // Distinguished from a reachable server omitting a field by the
  // `reachable` flag, not by the field values (which read null either
  // way at this layer).
  test("unreachable base URL: reachable:false, fields null rather than thrown", async () => {
    const result = await fetchServerProvenance(
      "http://127.0.0.1:1", // a port nothing listens on
      { timeoutMs: 500 },
    );
    assert.equal(result.reachable, false);
    assert.equal(result.loadedCommit, null);
    assert.equal(result.loadedTreeDirty, null);
  });
});
