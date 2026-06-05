import { extractText } from "#ai/shared/domInteraction.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

export async function extractGrokResponse(page) {
  // Grok 4 prepends a "Thought for Xs" thinking block (class "thinking-container")
  // before the actual response. Extract only the non-thinking sibling; fall back
  // to the full bubble with the thinking block stripped.
  const bubble = page
    .locator(".message-bubble, .response-content-markdown, div[id^='response-']")
    .last();

  // Prefer the div.relative that immediately follows the thinking-container
  let text = await bubble
    .locator("div.relative")
    .last()
    .innerText()
    .catch(() => null);

  if (!text || text.trim().length < 2) {
    text = await extractText(page, bubble);
  }

  // Strip any residual thinking header ("Thought for 5s", "Thinking...", etc.)
  text = (text || "").replace(/^(?:Thought(?:\s+for\s+[\d.]+s?)?|Thinking\.+)\s*\n?/i, "").trimStart();

  return cleanAiResponse(text);
}
