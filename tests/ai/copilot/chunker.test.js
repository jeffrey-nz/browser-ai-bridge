import test from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "#ai/copilot/client/interaction/prompt/send/chunker.js";

test.describe("Copilot Chunker: chunkText", () => {
  test("returns a single chunk if text is within limit", () => {
    const text = "Small prompt";
    const chunks = chunkText(text, 100);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "Small prompt");
  });

  test("splits text cleanly by newlines when possible", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const chunks = chunkText(text, 10);

    // "Line 1" (6) + "\n" + "Line 2" (6) > 10, so it should split
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0], "Line 1");
    assert.equal(chunks[1], "Line 2");
    assert.equal(chunks[2], "Line 3");
  });

  test("hard slices long lines that exceed the limit without newlines", () => {
    const text = "ThisIsAVeryLongStringWithoutSpacesOrNewlines";
    const chunks = chunkText(text, 10);
    assert.equal(chunks.length, 5); // 44 chars / 10 = 5 chunks
    assert.equal(chunks[0], "ThisIsAVer");
    assert.equal(chunks[1], "yLongStrin");
  });

  test("handles empty inputs safely", () => {
    const chunks = chunkText("", 100);
    assert.equal(chunks.length, 0);
  });

  test("defaults to safe max length if given invalid number", () => {
    const text = "A".repeat(3000);
    const chunks = chunkText(text, "invalid");
    // Default safeMaxLen is 2000
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, 2000);
    assert.equal(chunks[1].length, 1000);
  });
});
