import { ensureLocator } from "../../ensureLocator.js";

// Outer container: covers both legacy and modern Copilot DOM structures.
// The acceptance check (domSignals.js) and AI_MESSAGE_COUNT_SELECTOR (state.js)
// were already updated to include the modern selectors — this keeps extraction
// in sync with those.
export const OUTER_CONTAINER_SEL = [
  'div[data-test="DeepLeo"]',              // legacy copilot.microsoft.com
  ".fai-CopilotMessage",                   // legacy / Fluent AI
  '[data-testid="ai-message"]',            // modern copilot.microsoft.com
  '[data-testid="chat-message-content"]',  // modern copilot.microsoft.com
].join(", ");

const INNER_CONTENT_SEL = [
  '[data-testid="markdown-reply"]',
  ".markdown-body",
  ".ac-textBlock",
  ".message-content",
  "[data-message-content]",
].join(", ");

export async function getLastMessageContainer(page, options = {}) {
  const { optional = false } = options;

  return await ensureLocator(
    page,
    "message_body",
    "the AI response body",
    () =>
      page
        .locator(OUTER_CONTAINER_SEL)
        .last()
        .locator(INNER_CONTENT_SEL)
        .last(),
    { optional, requireVisible: false },
  );
}
