import { getLastMessageContainer, OUTER_CONTAINER_SEL } from "./locator.js";
import { extractCodeBlocks } from "./codeBlocks.js";

/**
 * Strip UI chrome that bleeds into innerText extraction:
 *   - "Copilot said" (screen-reader label that prefixes every AI message)
 *   - "See my thinking" (chain-of-thought toggle button)
 *   - "Show thinking" (alternate label)
 *   - "Download" (download-as-file action)
 *
 * Without this, a response like `{ "goal": "..." }` arrives as
 * `Copilot said See my thinking { "goal": "..." }`, which trips every
 * downstream JSON parser the agent has — including projectManager's, which
 * then thinks the response was empty and forces 3 retries.
 */
function stripCopilotChrome(text) {
  if (!text) return text;
  let t = text;
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(/^Copilot said[\s ]+/i, "");
    t = t.replace(/^(See|Show)\s+my\s+thinking[\s ]+/i, "");
    t = t.replace(/^(See|Show)\s+thinking[\s ]+/i, "");
    t = t.replace(/^Download[\s ]*\n?/i, "");
    if (t === before) break;
  }
  return t;
}

export async function extractLastMessage(page, options = {}) {
  const { optional = false, fast = false } = options;
  const lastMessage = await getLastMessageContainer(page, { optional });

  if (!lastMessage) return "";

  let text = await lastMessage.innerText({ timeout: 2000 }).catch(() => "");

  // If the inner-scoped locator returned nothing (inner selectors may be stale
  // for the current Copilot DOM), fall back to reading the outer message
  // container directly. This keeps extraction working when the Copilot UI
  // changes its inner element structure.
  if (!text.trim()) {
    text = await page
      .locator(OUTER_CONTAINER_SEL)
      .last()
      .innerText({ timeout: 2000 })
      .catch(() => "");
  }

  if (!text.trim()) {
    const progressText = await page
      .evaluate(() => {
        const lastAi = document.querySelectorAll(
          '[data-content="ai-message"], div[id^="chatMessageResponse-"]',
        );
        if (!lastAi.length) return "";
        const el = lastAi[lastAi.length - 1];
        const span = el.querySelector(
          'span[data-message-type="Progress"], .ac-textBlock p',
        );
        return span ? span.innerText : "";
      })
      .catch(() => "");

    if (progressText) return progressText.trim();
  }

  if (fast) return stripCopilotChrome(text).trim();

  const codeBlocks = lastMessage.locator(
    '[class*="scriptor-component-code-block"], pre, .code-block-container, code',
  );

  const blockCount = await codeBlocks.count().catch(() => 0);

  if (blockCount > 0) {
    const rawText = await lastMessage
      .evaluate((el) => {
        const clone = el.cloneNode(true);
        const blocks = clone.querySelectorAll(
          '[class*="scriptor-component-code-block"], pre, .code-block-container, code',
        );
        blocks.forEach((b) => b.remove());
        return clone.innerText || clone.textContent || "";
      })
      .catch(() => "");

    const clipboardBlocks = await extractCodeBlocks(
      page,
      codeBlocks,
      blockCount,
    );

    return stripCopilotChrome(`${rawText}\n\n${clipboardBlocks}`).trim();
  }

  return stripCopilotChrome(text).trim();
}
