import { extractText } from "#ai/shared/domInteraction.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

export async function extractChatGptResponse(page) {
  const rawText = await extractText(
    page,
    page
      .locator('[data-testid^="conversation-turn-"]')
      .last()
      .locator(".markdown"),
    null,
    [],
  );

  return cleanAiResponse(rawText);
}
