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

  return cleanAiResponse(text);
}
