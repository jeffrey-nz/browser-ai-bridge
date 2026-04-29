import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";
import { getProviderOverride } from "../../../../heal/overrides.js";
import { resolveSelector } from "#ai/shared/locatorEngine.js";
import { DEEPSEEK_LOCATORS } from "../../locators.js";

export async function extractDeepSeekResponse(page, initialAiBlockCount = 0) {
  // .ds-markdown only wraps AI response content — user messages never get
  // this class.  Using it here keeps the count aligned with the
  // initialAiBlockCount passed from index.js (which also uses .ds-markdown),
  // so we never accidentally capture the user's own sent prompt text.
  const aiBlocks = page.locator(".ds-markdown");
  const totalCount = await aiBlocks.count().catch(() => 0);

  if (totalCount > initialAiBlockCount) {
    const newTexts = [];
    for (let i = initialAiBlockCount; i < totalCount; i++) {
      const t = await aiBlocks.nth(i).innerText().catch(() => "");
      if (t.trim()) newTexts.push(t.trim());
    }
    if (newTexts.length > 0) {
      const cleaned = cleanAiResponse(newTexts.join("\n\n"));
      // Guard: if the extracted text looks like raw HTML from a wrong page
      // (e.g. DeepSeek navigated to its API playground), return "" so the
      // empty-response handler fires instead of poisoning the plan parser.
      if (looksLikeWrongPage(cleaned)) return "";
      return cleaned;
    }
  }

  // Fallback: broad selector, last element (original pre-loop behavior).
  const override = getProviderOverride("deepseek");
  const responseChain =
    override?.responseBlock ?? DEEPSEEK_LOCATORS.responseBlock;
  const responseSel = await resolveSelector(page, responseChain, 500);
  try {
    const lastResponse = page.locator(responseSel).last();
    await lastResponse.waitFor({ state: "attached", timeout: 5000 });
    const cleaned = cleanAiResponse(await lastResponse.innerText().catch(() => ""));
    if (looksLikeWrongPage(cleaned)) return "";
    return cleaned;
  } catch {
    return "";
  }
}

// Returns true when the extracted text looks like raw HTML from a non-chat page
// (e.g. DeepSeek's API playground) rather than an actual AI response.
// Detects patterns like "<select>", "<div id='playground-mount'>".
function looksLikeWrongPage(text) {
  if (!text) return false;
  // Short string starting with an HTML tag — almost certainly wrong-page content.
  return text.length < 200 && /^<[a-zA-Z]/.test(text);
}
