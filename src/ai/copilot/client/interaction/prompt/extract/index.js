import { getLastMessageContainer, OUTER_CONTAINER_SEL } from "./locator.js";
import { extractCodeBlocks } from "./codeBlocks.js";

/**
 * Strip UI chrome that bleeds into innerText extraction:
 *   - "Copilot said" (screen-reader label that prefixes every AI message)
 *   - "See my thinking" / "Show thinking" (chain-of-thought toggle button)
 *   - "Download" (download-as-file action)
 *   - "JSON Copy", "JavaScript Copy", etc. (code-block language tag + copy button)
 *   - Plain "Copy" button text
 *
 * Without this, a response like `{ "goal": "..." }` arrives as something like
 * `Copilot said See my thinking JSON Copy { "goal": "..." }` and every
 * downstream JSON parser the agent has treats it as junk.
 *
 * Uses [\s ] to also match non-breaking spaces, which Copilot inserts
 * between chrome elements.
 */
function stripCopilotChrome(text) {
  if (!text) return text;
  let t = text;
  for (let i = 0; i < 8; i++) {
    const before = t;
    t = t.replace(/^Copilot said[\s ]+/i, "");
    t = t.replace(/^(See|Show)[\s ]+my[\s ]+thinking[\s ]+/i, "");
    t = t.replace(/^(See|Show)[\s ]+thinking[\s ]+/i, "");
    t = t.replace(/^Download[\s ]*\n?/i, "");
    // Code-block chrome: language tag + copy button bleeds into innerText
    // when a code block is part of the message.
    t = t.replace(
      /^(json|javascript|typescript|markdown|html|css|python|bash|shell|yaml|xml|sql|java|csharp|c#|go|rust|ruby|php)[\s ]+copy[\s ]*\n?/i,
      "",
    );
    // Plain "Copy" at start (when code block has no language label).
    t = t.replace(/^Copy[\s ]*\n/i, "");
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
