import { extractText } from "#ai/shared/domInteraction.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

export async function extractGrokResponse(page) {
  const text = await extractText(
    page,
    page
      .locator(
        ".message-bubble, .response-content-markdown, div[id^='response-']",
      )
      .last(),
  );

  return cleanAiResponse(text);
}
