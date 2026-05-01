import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

export async function extractGeminiResponse(page) {
  const snackbar = page
    .locator("bard-simple-snack-bar, .mat-mdc-simple-snack-bar")
    .last();
  const isSnackbarVisible = await snackbar
    .isVisible({ timeout: 500 })
    .catch(() => false);

  if (isSnackbarVisible) {
    const snackText = await snackbar.innerText().catch(() => "");
    if (
      snackText.includes("(13)") ||
      snackText.toLowerCase().includes("something went wrong")
    ) {
      return "[GEMINI_UI_ERROR] ERROR_13_COOLDOWN";
    }
  }

  const lastResponse = page
    .locator("model-response, message-content, response-container")
    .last();

  const stopped = page
    .locator(".stopped-draft-message, .error-container, .blocked-response-text")
    .last();

  if (await stopped.isVisible({ timeout: 500 })) {
    return "[GEMINI_UI_ERROR] ERROR_13_COOLDOWN";
  }

  const codeBlock = lastResponse
    .locator(
      "code-block, pre code, .code-container, .query-response-text-content",
    )
    .first();

  let text = "";
  if (await codeBlock.isVisible({ timeout: 1000 })) {
    text = await codeBlock.innerText();
  } else {
    text = await lastResponse.innerText({ timeout: 2000 }).catch(() => "");
  }

  const cleaned = cleanAiResponse(text);

  // If the main chat response is suspiciously short (< 20 chars) or contains no
  // JSON brackets, Gemini may have routed content to a Canvas/artifact panel.
  // Try to extract from the canvas as a fallback so we don't lose tool calls.
  if (cleaned.length < 20 || (!cleaned.includes("[") && !cleaned.includes("{"))) {
    const canvasSelectors = [
      "ms-artifact",
      "artifact-viewer",
      ".canvas-container",
      "bard-canvas",
      ".immersive-drawer",
      "[data-panel-type='code']",
    ];
    for (const sel of canvasSelectors) {
      const canvasText = await page
        .locator(sel)
        .last()
        .innerText({ timeout: 1000 })
        .catch(() => "");
      if (canvasText && canvasText.trim().length > cleaned.length) {
        return cleanAiResponse(canvasText);
      }
    }
  }

  return cleaned;
}
