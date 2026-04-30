import test from "node:test";
import assert from "node:assert/strict";
import {
  extractStructuredData,
  extractAndNormalize,
} from "#utils/responseParser.js";

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

  test("repairs trailing commas in JSON arrays", () => {
    const aiResponse =
      '\x60\x60\x60json\n[{"tool": "read_file", "path": "/foo",},]\n\x60\x60\x60';
    const result = extractStructuredData(aiResponse);
    assert.deepEqual(result, [{ tool: "read_file", path: "/foo" }]);
  });

  test("repairs trailing commas in raw JSON", () => {
    const result = extractStructuredData(
      '[{"tool": "list_dir", "path": "/",},]',
    );
    assert.deepEqual(result, [{ tool: "list_dir", path: "/" }]);
  });

  test("repairs unescaped double quotes in JSON strings", () => {
    // DeepSeek sometimes emits: {"content": "new GameObject("enemy")"}
    const raw =
      '\x60\x60\x60json\n[{"tool": "write_file", "content": "new GameObject(\\"enemy\\")"}]\n\x60\x60\x60';
    const result = extractStructuredData(raw);
    assert.ok(Array.isArray(result), "should return an array");
    assert.equal(result[0].tool, "write_file");
  });

  test("extracts JSON after a reasoning prefix", () => {
    const aiResponse =
      'Let me think about this...\n[{"tool": "read_file", "path": "/foo.js"}]';
    const result = extractStructuredData(aiResponse);
    assert.deepEqual(result, [{ tool: "read_file", path: "/foo.js" }]);
  });
});

test.describe("Response Parser: extractAndNormalize", () => {
  test("returns data and original text when JSON is already clean", () => {
    const text = '[{"tool": "read_file", "path": "/foo.js"}]';
    const { data, normalizedText } = extractAndNormalize(text);
    assert.deepEqual(data, [{ tool: "read_file", path: "/foo.js" }]);
    assert.equal(normalizedText, text);
  });

  test("returns repaired normalizedText when original has trailing commas", () => {
    const text = '[{"tool": "read_file", "path": "/foo.js",},]';
    const { data, normalizedText } = extractAndNormalize(text);
    assert.deepEqual(data, [{ tool: "read_file", path: "/foo.js" }]);
    // normalizedText should be parseable by naive JSON.parse
    assert.doesNotThrow(() => JSON.parse(normalizedText));
  });

  test("extracts data correctly from JSON inside a code block", () => {
    const text =
      'Here is my response:\n\x60\x60\x60json\n[{"tool": "write_file"}]\n\x60\x60\x60';
    const { data } = extractAndNormalize(text);
    assert.deepEqual(data, [{ tool: "write_file" }]);
  });

  test("returns null data and original text when no JSON found", () => {
    const text = "I have no tool calls to make.";
    const { data, normalizedText } = extractAndNormalize(text);
    assert.equal(data, null);
    assert.equal(normalizedText, text);
  });
});
