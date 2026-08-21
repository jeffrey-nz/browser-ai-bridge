import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildInitialPrompt } from "../src/routes/ask/executor/prompts.js";

test.describe("buildInitialPrompt — the API-Turn guard", () => {
  test("no label: treated as API Turn, prompt returned unchanged", () => {
    const out = buildInitialPrompt("deepseek", "hello", false);
    assert.equal(out, "hello");
  });

  test('label "API Turn": prompt returned unchanged', () => {
    const out = buildInitialPrompt("deepseek", "hello", false, "API Turn");
    assert.equal(out, "hello");
  });

  test(
    'label "vision-probe" (bare, no "API Turn" prefix): a plain ' +
      "diagnostic label slips the guard and picks up a provider constraint " +
      "— this is the T-041 bug, and it stays true on purpose: the fix is at " +
      "the caller (scripts/vision-probe.mjs's label), not in this guard.",
    () => {
      const out = buildInitialPrompt(
        "deepseek",
        "hello",
        false,
        "vision-probe",
      );
      assert.ok(
        out.includes("FORMAT REQUIREMENT"),
        "documents the guard's actual (string-prefix) behaviour",
      );
    },
  );

  test(
    'label "API Turn: vision-probe": T-041 — this is the label vision-probe.mjs ' +
      "actually sends, and it must be treated as an API Turn (no constraint)",
    () => {
      const out = buildInitialPrompt(
        "deepseek",
        "hello",
        false,
        "API Turn: vision-probe",
      );
      assert.equal(
        out,
        "hello",
        'a label starting with "API Turn" must not have a provider constraint prepended',
      );
      assert.ok(!out.includes("FORMAT REQUIREMENT"));
    },
  );

  test("real agent label still gets its constraint (coder, non-read-only)", () => {
    const out = buildInitialPrompt("deepseek", "hello", false, "coder");
    assert.ok(
      out.includes("FORMAT REQUIREMENT"),
      "a real agent task label must still receive the constraint",
    );
    assert.ok(out.endsWith("hello"));
  });

  test(
    'T-041: vision-probe.mjs\'s own default label starts with "API Turn" — ' +
      "pins the regression at the actual call site, not only in this guard's " +
      "own logic (a label edit in the script would otherwise re-introduce the " +
      "bug without touching prompts.js at all)",
    () => {
      const scriptPath = fileURLToPath(
        new URL("../scripts/vision-probe.mjs", import.meta.url),
      );
      const src = readFileSync(scriptPath, "utf8");
      const m = src.match(/label:\s*"([^"]*)"/);
      assert.ok(m, "vision-probe.mjs must set a default label");
      assert.ok(
        m[1].startsWith("API Turn"),
        `vision-probe.mjs's default label ${JSON.stringify(m[1])} must start with "API Turn"`,
      );
    },
  );
});
