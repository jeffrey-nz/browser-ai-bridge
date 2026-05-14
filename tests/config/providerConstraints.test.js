import test from "node:test";
import assert from "node:assert/strict";
import { buildPromptConstraint } from "../../src/config/providerConstraints.js";

test.describe("buildPromptConstraint", () => {
  test("returns empty string for unknown provider", () => {
    assert.equal(buildPromptConstraint("unknown"), "");
    assert.equal(buildPromptConstraint("openai"), "");
  });

  test("deepseek: uses read_file example for researcher label", () => {
    const constraint = buildPromptConstraint("deepseek", "researcher turn 1");
    assert.ok(
      constraint.includes("read_file"),
      "should use read_file for researcher",
    );
    assert.ok(
      !constraint.includes("write_file"),
      "should not use write_file for researcher",
    );
  });

  test("deepseek: uses read_file example for scoper label", () => {
    const constraint = buildPromptConstraint("deepseek", "scoper");
    assert.ok(constraint.includes("read_file"));
  });

  test("deepseek: uses write_file example for coder label", () => {
    const constraint = buildPromptConstraint("deepseek", "coder turn 3");
    assert.ok(
      constraint.includes("write_file"),
      "should use write_file for coder",
    );
  });

  test("deepseek: uses write_file example when no label given", () => {
    const constraint = buildPromptConstraint("deepseek");
    assert.ok(constraint.includes("write_file"));
  });

  test("deepseek: constraint includes empty array instruction", () => {
    const constraint = buildPromptConstraint("deepseek", "coder");
    assert.ok(
      constraint.includes("[]"),
      "should include empty array fallback instruction",
    );
  });

  test("gemini: returns non-empty constraint", () => {
    const constraint = buildPromptConstraint("gemini");
    assert.ok(constraint.length > 0);
    assert.ok(
      constraint.includes("```json"),
      "should include code block format",
    );
  });
});
