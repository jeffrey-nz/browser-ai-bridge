import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import { logger } from "#utils/logger.js";
import { TOO_MANY_REQUESTS_SEL } from "../chat.js";

const RATE_LIMIT_SEL =
  '.text-token-text-secondary:has-text("message limit"), ' +
  'div:has-text("You\'ve reached your message limit")';

export async function waitForChatGptCompletion(
  page,
  prevText = "",
  sessionId = null,
) {
  const stopBtn = page.locator('[data-testid="stop-button"]');
  const errorAlert = page
    .locator('.alert-error, [role="alert"]:not(.sr-only)')
    .last();

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  eventBus.once("abort_requested", abortHandler);

  // Session-specific abort: fires when the HTTP client disconnects mid-poll.
  let sessionAbortHandler = null;
  if (sessionId) {
    sessionAbortHandler = () => {
      aborted = true;
    };
    eventBus.once(`session_abort:${sessionId}`, sessionAbortHandler);
  }

  try {
    // Check for "too many requests" throttle immediately after send — before
    // the 1500ms blind wait so we don't spend time polling a blocked session.
    const earlyThrottle = await page
      .locator(TOO_MANY_REQUESTS_SEL)
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (earlyThrottle) {
      const err = new Error("ChatGPT — Too many requests (temporary throttle)");
      err.stalled = true;
      err.rateLimited = true;
      throw err;
    }

    await page.waitForTimeout(500);

    let lastTextLength = 0;
    let stableIterations = 0;
    // Settled + Stop button gone → done quickly. Settled this long even with
    // the Stop button lingering → done anyway (see force-done note below).
    const STABLE_DONE = 4;
    const STABLE_FORCE_DONE = 20;

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
          const err = new Error(
            "ChatGPT rate limit reached — message limit hit",
          );
          err.rateLimited = true;
          throw err;
        }

        const tooManyVisible = await page
          .locator(TOO_MANY_REQUESTS_SEL)
          .first()
          .isVisible({ timeout: 200 })
          .catch(() => false);
        if (tooManyVisible) {
          const err = new Error(
            "ChatGPT — Too many requests (temporary throttle)",
          );
          err.stalled = true;
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

        // Track text stability every poll, regardless of the Stop button —
        // so a finished-but-still-streaming-looking turn is still recognised.
        if (currentText.length > 0 && currentText.length === lastTextLength) {
          stableIterations++;
        } else {
          stableIterations = 0;
        }
        lastTextLength = currentText.length;

        if (isNewMessage) {
          // Normal completion: text settled and the Stop button is gone.
          if (!isGenerating && stableIterations >= STABLE_DONE) {
            return true;
          }
          // Robustness: ChatGPT regularly leaves the Stop button in the DOM
          // after a turn is fully written, so !isGenerating never becomes true
          // and the poll would otherwise hold the caller for the full 5-min
          // timeout before "early-extracting" a response that was ready minutes
          // ago. A response byte-for-byte stable this long is done regardless.
          if (stableIterations >= STABLE_FORCE_DONE) {
            return true;
          }
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
    if (e.stalled) throw e;
    logger.warn(`[ChatGPT Poll] Error or Timeout: ${e.message}`);
    return false;
  } finally {
    eventBus.off("abort_requested", abortHandler);
    if (sessionId && sessionAbortHandler) {
      eventBus.off(`session_abort:${sessionId}`, sessionAbortHandler);
    }
  }
}
