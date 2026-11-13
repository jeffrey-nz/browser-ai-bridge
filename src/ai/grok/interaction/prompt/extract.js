import { extractText } from "#ai/shared/domInteraction.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";
import { GROK_LOCATORS as L } from "#ai/grok/locators.js";

export async function extractGrokResponse(page) {
  // Grok 4 prepends a "Thought for Xs" thinking block (class "thinking-container")
  // before the actual response. Extract only the non-thinking sibling; fall back
  // to the full bubble with the thinking block stripped.
  // The assistant's bubble only — `.message-bubble` alone is also the user's.
  const bubble = page.locator(L.assistantMessage).last();

  // The answer's own markdown body; it skips the bubble's "Grok" heading and
  // the thinking block. Then the div.relative that follows the thinking
  // container (the older layout).
  let text = await bubble
    .locator(".response-content-markdown")
    .last()
    .innerText()
    .catch(() => null);
  if (!text || text.trim().length < 1) {
    text = await bubble
      .locator("div.relative")
      .last()
      .innerText()
      .catch(() => null);
  }

  if (!text || text.trim().length < 1) {
    text = (await extractText(page, bubble)).replace(/^Grok\s*\n+/, "");
  }

  // Strip any residual thinking header ("Thought for 5s", "Thinking...", etc.)
  text = (text || "")
    .replace(/^(?:Thought(?:\s+for\s+[\d.]+s?)?|Thinking\.+)\s*\n?/i, "")
    .trimStart();

  return cleanAiResponse(text);
}
