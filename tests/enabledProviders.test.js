import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnabledProviders } from "../src/startup/providers.js";

test("unset or empty BROWSER_AI_PROVIDERS means every provider", () => {
  assert.equal(parseEnabledProviders(undefined), null);
  assert.equal(parseEnabledProviders(""), null);
});

test("ids are trimmed and lower-cased", () => {
  assert.deepEqual(
    [...parseEnabledProviders(" ChatGPT,gemini ,DeepSeek")],
    ["chatgpt", "gemini", "deepseek"],
  );
});
