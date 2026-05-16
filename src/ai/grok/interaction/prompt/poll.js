import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";

const RATE_LIMIT_SEL =
  'div.text-primary:has-text("Message limit reached"), ' +
  'button:has-text("SuperGrok"), ' +
  "div.bg-card:has(svg.lucide-triangle-alert)";

export async function waitForGrokCompletion(page) {
  let aborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  eventBus.once("abort_requested", abortHandler);

  try {
    await page.waitForTimeout(1500);

    let lastTextLength = 0;
    let stableIterations = 0;

    return await pollUntil(
      async () => {
        if (aborted) throw new Error("Aborted (Web UI)");

        const rateLimitVisible = await page
          .locator(RATE_LIMIT_SEL)
          .first()
          .isVisible({ timeout: 200 })
          .catch(() => false);
        if (rateLimitVisible) {
          const err = new Error("Grok rate limit reached — message limit hit");
          err.rateLimited = true;
          throw err;
        }

        const lastMessage = page
          .locator(
            ".message-bubble, .response-content-markdown, div[id^='response-']",
          )
          .last();
        const currentText = await lastMessage.innerText().catch(() => "");

        const doneSignal = page
          .locator(
            "button[aria-label='Like'], button[aria-label='Copy'], button[aria-label*='share' i]",
          )
          .last();

        const isDoneSignalVisible = await doneSignal
          .isVisible()
          .catch(() => false);

        if (currentText.length > 0) {
          if (isDoneSignalVisible) return true;

          if (currentText.length === lastTextLength) {
            stableIterations++;
            if (stableIterations >= 6) return true;
          } else {
            stableIterations = 0;
          }
        }

        lastTextLength = currentText.length;
        return false;
      },
      {
        timeoutMs: 600000,
        pollIntervalMs: 500,
        errorMessage: "Grok polling timed out",
      },
    );
  } catch (e) {
    if (e.message.includes("Aborted")) throw e;
    if (e.rateLimited) throw e;
    logger.warn(`[Grok Poll] Error: ${e.message}`);
    return false;
  } finally {
    eventBus.off("abort_requested", abortHandler);
  }
}
