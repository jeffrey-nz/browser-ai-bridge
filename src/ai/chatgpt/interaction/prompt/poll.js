import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import { logger } from "#utils/logger.js";

const RATE_LIMIT_SEL =
  '.text-token-text-secondary:has-text("message limit"), ' +
  'div:has-text("You\'ve reached your message limit")';

export async function waitForChatGptCompletion(page, prevText = "") {
  const stopBtn = page.locator('[data-testid="stop-button"]');
  const errorAlert = page
    .locator('.alert-error, [role="alert"]:not(.sr-only)')
    .last();

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  eventBus.once("abort_requested", abortHandler);

  try {
    await page.waitForTimeout(1500);

    let lastTextLength = 0;
    let stableIterations = 0;

    const isComplete = await pollUntil(
      async () => {
        if (aborted) throw new Error("Aborted (Web UI)");

        if (await errorAlert.isVisible().catch(() => false)) {
          return true;
        }

        const rateLimitVisible = await page
          .locator(RATE_LIMIT_SEL)
          .first()
          .isVisible({ timeout: 200 })
          .catch(() => false);
        if (rateLimitVisible) {
          const err = new Error("ChatGPT rate limit reached — message limit hit");
          err.rateLimited = true;
          throw err;
        }

        const isGenerating = await stopBtn.isVisible().catch(() => false);
        const lastMessage = page
          .locator('[data-testid^="conversation-turn-"]')
          .last();
        const currentText = await lastMessage.innerText().catch(() => "");

        const isNewMessage =
          currentText !== prevText && currentText.trim().length > 0;

        if (isNewMessage && !isGenerating) {
          if (currentText.length > 0 && currentText.length === lastTextLength) {
            stableIterations++;
          } else {
            stableIterations = 0;
          }

          if (stableIterations >= 4) {
            return true;
          }
          lastTextLength = currentText.length;
        } else if (isGenerating) {
          stableIterations = 0;
        }

        return false;
      },
      {
        timeoutMs: 300000,
        pollIntervalMs: 500,
        errorMessage: "ChatGPT polling timed out",
      },
    );

    return isComplete && !(await errorAlert.isVisible().catch(() => false));
  } catch (e) {
    if (e.message.includes("Aborted")) throw e;
    if (e.rateLimited) throw e;
    logger.warn(`[ChatGPT Poll] Error or Timeout: ${e.message}`);
    return false;
  } finally {
    eventBus.off("abort_requested", abortHandler);
  }
}
