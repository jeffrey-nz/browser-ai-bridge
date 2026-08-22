import { test } from "node:test";
import assert from "node:assert/strict";
import { logTimeoutSnapshot } from "../src/ai/deepseek/interaction/prompt/poll/timeoutSnapshot.js";
import { logger } from "#utils/logger.js";

/**
 * T-117 clause (a): the now-deleted deepseek poll.js captured a snippet of
 * the page's own text on its 300s timeout; the live poll/waiter.js lost
 * that capture during decomposition (it just logged a bare "Timed out
 * after 300s."). logTimeoutSnapshot() is the ported capture, pinned
 * directly — driving waiter.js's own 300s deadline loop in a test costs
 * more than this clause is worth, so the call site itself (one line in
 * waiter.js) is not independently driven here; this function is.
 */

function fakePage(bodyText, { throws = false } = {}) {
  return {
    locator(sel) {
      assert.equal(sel, "body");
      return {
        async innerText() {
          if (throws) throw new Error("page closed");
          return bodyText;
        },
      };
    },
  };
}

test("logTimeoutSnapshot logs the page's own text snippet, truncated to 300 chars with whitespace collapsed", async () => {
  const warnings = [];
  const original = logger.warn;
  logger.warn = (msg) => warnings.push(msg);
  try {
    const bodyText = "Something\n\nwent   wrong.".repeat(20); // > 300 chars
    await logTimeoutSnapshot(fakePage(bodyText));

    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^\[DeepSeek Poll\] Timed out after 300s\. Page text snippet: /,
    );
    // Whitespace collapsed (no literal newlines/runs of spaces survive).
    assert.doesNotMatch(warnings[0], /\n/);
    assert.doesNotMatch(warnings[0], /   /);
    // Truncated: the snippet portion itself is at most 300 chars of the
    // (whitespace-collapsed) body text, not the full repeated string.
    const quoted = warnings[0].match(/snippet: "(.*)"$/)[1];
    assert.ok(quoted.length <= 300);
  } finally {
    logger.warn = original;
  }
});

test("logTimeoutSnapshot falls back to a stated failure line when reading the page throws", async () => {
  const warnings = [];
  const original = logger.warn;
  logger.warn = (msg) => warnings.push(msg);
  try {
    await logTimeoutSnapshot(fakePage("", { throws: true }));
    assert.deepEqual(warnings, [
      "[DeepSeek Poll] Timed out after 300s. (could not capture page text)",
    ]);
  } finally {
    logger.warn = original;
  }
});
