import { getLastMessageContainer, OUTER_CONTAINER_SEL } from "./locator.js";
import { extractCodeBlocks } from "./codeBlocks.js";

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

  if (fast) return text.replace(/^Download\s*\n/i, "").trim();

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

    return `${rawText}\n\n${clipboardBlocks}`.trim();
  }

  return text.replace(/^Download\s*\n/i, "").trim();
}
