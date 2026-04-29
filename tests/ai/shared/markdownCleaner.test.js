import test from "node:test";
import assert from "node:assert/strict";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

test.describe("Markdown Cleaner: cleanAiResponse", () => {
  test("removes 'Copy code' headers", () => {
    const raw = "Copy code\nHere is your text.";
    const result = cleanAiResponse(raw);
    assert.equal(result, "Here is your text.");
  });

  test("removes inline 'Copy' buttons", () => {
    const raw = "Here is some code.\nCopy\nMore code.";
    const result = cleanAiResponse(raw);
    assert.equal(result, "Here is some code.\nMore code.");
  });

  test("wraps 'Thought' blocks in XML tags", () => {
    const raw = "Thought\nI should write some code.\nHere is the code.";
    const result = cleanAiResponse(raw);
    assert.equal(
      result,
      "<thought>\nI should write some code.\nHere is the code.",
    );
  });

  test("trims leading format prefixes like 'JSON:'", () => {
    const raw = 'JSON:\n{"hello": "world"}';
    const result = cleanAiResponse(raw);
    assert.equal(result, '{"hello": "world"}');
  });

  test("handles empty or null input", () => {
    assert.equal(cleanAiResponse(null), "");
    assert.equal(cleanAiResponse(""), "");
    assert.equal(cleanAiResponse("   "), "");
  });
});
