import test from "node:test";
import assert from "node:assert/strict";
import { resolveModeKey, AI_MODES } from "#ai/modes.js";

test.describe("AI Modes: resolveModeKey", () => {
  test("resolves thinking variants to THINKING mode", () => {
    assert.equal(resolveModeKey("o1"), AI_MODES.THINKING);
    assert.equal(resolveModeKey("thinkdeeper"), AI_MODES.THINKING);
    assert.equal(resolveModeKey("deepthink"), AI_MODES.THINKING);
    assert.equal(resolveModeKey("r1"), AI_MODES.THINKING);
  });

  test("resolves fast variants to FAST mode", () => {
    assert.equal(resolveModeKey("fast"), AI_MODES.FAST);
    assert.equal(resolveModeKey("4o-mini"), AI_MODES.FAST);
    assert.equal(resolveModeKey("flash"), AI_MODES.FAST);
  });

  test("resolves pro variant to PRO mode", () => {
    assert.equal(resolveModeKey("pro"), AI_MODES.PRO);
  });

  test("defaults to AUTO for unknown or null keys", () => {
    assert.equal(resolveModeKey(null), AI_MODES.AUTO);
    assert.equal(resolveModeKey(""), AI_MODES.AUTO);
    assert.equal(resolveModeKey("random-string"), AI_MODES.AUTO);
  });
});
