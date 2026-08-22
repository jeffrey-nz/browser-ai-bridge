import { logger } from "#utils/logger.js";

// T-117: the now-deleted src/ai/deepseek/interaction/prompt/poll.js (dead
// since before this decomposition — T-115) captured a snippet of the
// page's own text when its 300s poll timed out, so the log said WHAT
// DeepSeek was showing (an error dialog, an empty page, a busy state)
// instead of just that it gave up. That capture did not make the jump
// into this directory. Extracted into its own function — not inlined at
// the timeout call site in waiter.js — because driving waiter.js's own
// 300s deadline loop in a test costs more than this clause is worth; this
// function is what's pinned directly, and the call site (one line in
// waiter.js) is not independently driven by a test.
export async function logTimeoutSnapshot(page) {
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 2000 });
    const snippet = bodyText.slice(0, 300).replace(/\s+/g, " ").trim();
    logger.warn(
      `[DeepSeek Poll] Timed out after 300s. Page text snippet: "${snippet}"`,
    );
  } catch {
    logger.warn(
      "[DeepSeek Poll] Timed out after 300s. (could not capture page text)",
    );
  }
}
