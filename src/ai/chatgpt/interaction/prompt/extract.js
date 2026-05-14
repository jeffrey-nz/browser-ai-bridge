import { extractText } from "#ai/shared/domInteraction.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

export async function extractChatGptResponse(page) {
  const lastTurn = page.locator('[data-testid^="conversation-turn-"]').last();

  // Primary: .markdown div (most responses land here)
  const rawText = await extractText(
    page,
    lastTurn.locator(".markdown"),
    null,
    [],
  );
  if (rawText) return cleanAiResponse(rawText);

  // Secondary: canvas/artifact panel — ChatGPT may render code in a side panel
  // when the response is large or code-heavy (canvas mode).
  const canvasSelectors = [
    '[data-testid="canvas-container"]',
    '[data-testid="artifact"]',
    ".artifact-content",
    "aside pre",
    "aside code",
  ];
  for (const sel of canvasSelectors) {
    const canvasText = await page
      .locator(sel)
      .last()
      .innerText()
      .catch(() => "");
    if (canvasText && canvasText.trim().length > 10)
      return cleanAiResponse(canvasText);
  }

  // Tertiary: assistant turn text, stripping tool-plan reasoning UI elements
  // that appear when ChatGPT uses its internal tool-use UI.
  const assistantTurn = page
    .locator('[data-message-author-role="assistant"]')
    .last();
  const assistantText = await assistantTurn.innerText().catch(() => "");
  if (assistantText) {
    // Strip <tool-plan>...</tool-plan> sections — these are ChatGPT's internal reasoning
    // UI, not the actual response. Without stripping, the parser sees only the plan and
    // no JSON tool calls, triggering spurious toolplan-recovery loops.
    const stripped = assistantText
      .replace(/<tool-plan>[\s\S]*?<\/tool-plan>/gi, "")
      .trim();
    if (stripped) return cleanAiResponse(stripped);
  }

  return "";
}
