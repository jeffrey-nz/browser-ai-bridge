import test from "node:test";
import assert from "node:assert/strict";
import { extractStructuredData } from "#utils/responseParser.js";

test.describe("Response Parser: extractStructuredData", () => {
  test("extracts a single JSON block", () => {
    // Using \x60 to safely represent backticks in strings without breaking markdown
    const aiResponse =
      'Here is the data:\n\x60\x60\x60json\n{"key": "value"}\n\x60\x60\x60';
    const result = extractStructuredData(aiResponse);
    assert.deepEqual(result, { key: "value" });
  });

  test("extracts multiple JSON blocks as an array", () => {
    const aiResponse =
      'Block 1:\n\x60\x60\x60json\n{"tool": "read"}\n\x60\x60\x60\nBlock 2:\n\x60\x60\x60\n{"tool": "write"}\n\x60\x60\x60';
    const result = extractStructuredData(aiResponse);
    assert.deepEqual(result, [{ tool: "read" }, { tool: "write" }]);
  });

  test("falls back to raw JSON if no markdown blocks are present", () => {
    const aiResponse = '{"status": "success"}';
    const result = extractStructuredData(aiResponse);
    assert.deepEqual(result, { status: "success" });
  });

  test("returns null if no JSON is found", () => {
    const aiResponse = "I am an AI language model.";
    const result = extractStructuredData(aiResponse);
    assert.equal(result, null);
  });

  test("ignores malformed JSON blocks", () => {
    const aiResponse = "\x60\x60\x60json\n{malformed: true,\n\x60\x60\x60";
    const result = extractStructuredData(aiResponse);
    assert.equal(result, null);
  });
});
