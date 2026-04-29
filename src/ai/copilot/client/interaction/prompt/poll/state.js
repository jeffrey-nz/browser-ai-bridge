import { extractLastMessage } from "../extract/index.js";

// Unified selector used for both previousCount (submit.js) and currentCount
// (here). Must match exactly so currentCount > previousCount fires correctly
// when a new AI message appears.
export const AI_MESSAGE_COUNT_SELECTOR = [
  'div[data-test="DeepLeo"]',
  ".fai-CopilotMessage",
  'div[id^="chatMessageResponse-"]',
  '[data-testid="m365-chat-llm-web-ui-chat-message"]',
  '[data-content="ai-message"]',
  '[data-testid="ai-message"]',
  '[data-testid="chat-message-content"]',
].join(", ");

export async function pollDomState(page, locators) {
  const [isDone, isRefused, isGenerating, currentText, currentCount] =
    await Promise.all([
      locators.doneSignal.isVisible().catch(() => false),
      locators.refusalSignal.isVisible().catch(() => false),
      locators.stopBtn.isVisible().catch(() => false),
      extractLastMessage(page, { optional: true, fast: true }).catch(() => ""),
      page
        .evaluate(
          (sel) => document.querySelectorAll(sel).length,
          AI_MESSAGE_COUNT_SELECTOR,
        )
        .catch(() => 0),
    ]);

  return { isDone, isRefused, isGenerating, currentText, currentCount };
}
