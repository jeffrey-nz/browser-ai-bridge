import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";

export async function injectGeminiText(page, text) {
  await clearAndType(
    page,
    page
      .locator('div.ql-editor[contenteditable="true"], rich-textarea > div')
      .first(),
    text,
    { useEvalClear: false, triggerEvents: true, chunkSize: 3000 },
  );
}

export async function clickGeminiSend(page) {
  const snackbar = page
    .locator("bard-simple-snack-bar, .mat-mdc-simple-snack-bar")
    .last();

  await clickOrFallbackToEnter(
    page,
    page
      .locator(
        'button[aria-label*="Send message"], .send-button-container button, button.send-button, [data-test-id="send-button"]',
      )
      .last(),
    page
      .locator('div.ql-editor[contenteditable="true"], rich-textarea > div')
      .first(),
    page
      .locator('button[aria-label*="Stop"], [data-testid="stop-button"]')
      .last(),
    {
      retries: 4,
      ctrlEnterFallback: true,
      shouldAbort: async () => {
        const visible = await snackbar
          .isVisible({ timeout: 200 })
          .catch(() => false);
        if (!visible) return null;
        const txt = await snackbar.innerText().catch(() => "");
        if (
          txt.includes("(13)") ||
          txt.toLowerCase().includes("something went wrong")
        ) {
          return new Error("GEMINI_SNACKBAR_ERROR_13");
        }
        return null;
      },
    },
  );
}
