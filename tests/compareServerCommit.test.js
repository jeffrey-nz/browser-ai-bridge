import test from "node:test";
import assert from "node:assert/strict";
import { compareServerCommit } from "../scripts/vision-probe.mjs";

// T-049: a bridge process running a commit behind the one that started it
// silently invalidated live verification on T-042 and T-045 — nothing in a
// report or /api/ping distinguished a fresh server from one hours stale.
// compareServerCommit() is the tri-state rule that closes that gap: null
// means unmeasured and must never read as "fresh" (false).
test.describe("compareServerCommit", () => {
  test("returns null when bridgeCommit is unmeasured", () => {
    assert.equal(compareServerCommit(null, "abc123"), null);
  });

  test("returns null when the ping never returned a loadedCommit", () => {
    assert.equal(compareServerCommit("abc123", null), null);
  });

  test("returns null when both are unmeasured", () => {
    assert.equal(compareServerCommit(null, null), null);
  });

  test("returns false when the server is running the current HEAD", () => {
    assert.equal(compareServerCommit("abc123", "abc123"), false);
  });

  test("returns true when the server is behind HEAD", () => {
    assert.equal(compareServerCommit("abc123", "deadbee"), true);
  });
});
