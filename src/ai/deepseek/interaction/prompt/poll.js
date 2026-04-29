import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";
import { getProviderOverride } from "../../../../heal/overrides.js";
import { DEEPSEEK_LOCATORS } from "../../locators.js";

const DEFAULT_STOP_BTN = DEEPSEEK_LOCATORS.stopBtn;
const DEFAULT_RESPONSE_BLOCK = DEEPSEEK_LOCATORS.responseBlock;

const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 500;
const ABORT_CHECK_INTERVAL_MS = 80;

export async function waitForDeepSeekCompletion(
  page,
  initialMsgCount = 0,
  sessionId = null,
) {
  const override = getProviderOverride("deepseek");
  const stopBtnSelector = override?.stopBtn ?? DEFAULT_STOP_BTN;
  const responseSelector = override?.responseBlock ?? DEFAULT_RESPONSE_BLOCK;

  if (override?.stopBtn) {
    logger.debug(
      `[DeepSeek Poll] Using healed stopBtn: ${override.stopBtn.slice(0, 60)}...`,
    );
  }

  const stopBtn = page.locator(stopBtnSelector).last();
  const cfOverlay = page.locator("#cf-overlay");

  let aborted = false;
  let controlAborted = false;

  const abortHandler = () => {
    aborted = true;
  };
  const controlAbortHandler = () => {
    controlAborted = true;
    aborted = true;
  };

  eventBus.once("abort_requested", abortHandler);
  if (sessionId)
    eventBus.once(`session_control:${sessionId}`, controlAbortHandler);

  await page.waitForTimeout(1500);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastTextLength = 0;
  let stableIterations = 0;

  try {
    while (Date.now() < deadline) {
      if (controlAborted) {
        logger.info(
          "[DeepSeek Poll] Aborted by control signal — handing off to stall resolver.",
        );
        const err = new Error("CONTROL_ABORT: poll aborted by control signal");
        err.controlAbort = true;
        throw err;
      }
      if (aborted) {
        throw new Error("Aborted (Web UI)");
      }

      try {
        const isBlocked = await cfOverlay.isVisible().catch(() => false);
        if (isBlocked) {
          logger.error(
            "🛑 CLOUDFLARE BLOCK DETECTED. DeepSeek is requesting human verification.",
          );
          return false;
        }

        // Detect DeepSeek error / busy / rate-limit states — fail fast instead
        // of burning the full 300s timeout.
        const errorTexts = [
          "text=/server (busy|error|unavailable)/i",
          "text=/too many requests/i",
          "text=/rate limit/i",
          "text=/something went wrong/i",
          "text=/network error/i",
          "text=/failed to generate/i",
        ];
        for (const sel of errorTexts) {
          const visible = await page
            .locator(sel)
            .first()
            .isVisible()
            .catch(() => false);
          if (visible) {
            logger.warn(`[DeepSeek Poll] Error state detected: ${sel}`);
            return false;
          }
        }

        // "Regenerate" button appears when DeepSeek fails to generate a response
        const regenerateVisible = await page
          .locator(
            '[aria-label*="Regenerate" i], button:has-text("Regenerate"), .ds-icon-button:has-text("Regenerate")',
          )
          .first()
          .isVisible()
          .catch(() => false);
        if (regenerateVisible) {
          logger.warn(
            "[DeepSeek Poll] Regenerate button detected — generation failed.",
          );
          return false;
        }

        const isGenerating = await stopBtn.isVisible().catch(() => false);
        const currentCount = await page
          .locator(responseSelector)
          .count()
          .catch(() => 0);
        const lastMessage = page.locator(responseSelector).last();
        const currentText = await lastMessage.innerText().catch(() => "");

        const hasNewElement = currentCount > initialMsgCount;
        const textGrewSignificantly =
          currentCount === initialMsgCount &&
          currentText.length > lastTextLength + 20;
        const isNewMessage =
          (hasNewElement || textGrewSignificantly) &&
          currentText.trim().length > 0;

        if (isNewMessage && !isGenerating) {
          if (currentText.length > 0 && currentText.length === lastTextLength) {
            stableIterations++;
          } else {
            stableIterations = 0;
          }
          if (stableIterations >= 4) return true;
          lastTextLength = currentText.length;
        } else if (isGenerating) {
          stableIterations = 0;
        }
      } catch (playwrightErr) {
        if (
          playwrightErr.controlAbort ||
          playwrightErr.message.includes("Aborted (Web UI)")
        ) {
          throw playwrightErr;
        }
        logger.trace(
          `[DeepSeek Poll] Playwright error (ignored): ${playwrightErr.message}`,
        );
      }

      const sleepEnd = Date.now() + POLL_INTERVAL_MS;
      while (Date.now() < sleepEnd) {
        if (controlAborted) {
          const err = new Error(
            "CONTROL_ABORT: poll aborted by control signal",
          );
          err.controlAbort = true;
          throw err;
        }
        if (aborted) throw new Error("Aborted (Web UI)");
        await new Promise((r) => setTimeout(r, ABORT_CHECK_INTERVAL_MS));
      }
    }

    // Capture a brief diagnostic snapshot so the log tells us what DeepSeek
    // was showing when it timed out (error dialog, empty page, busy state, etc.).
    try {
      const bodyText = await page.locator("body").innerText({ timeout: 2000 });
      const snippet = bodyText.slice(0, 300).replace(/\s+/g, " ").trim();
      logger.warn(
        `[DeepSeek Poll] Timed out after 300s. Page text snippet: "${snippet}"`,
      );
    } catch {
      logger.warn(
        "[DeepSeek Poll] Timed out after 300s. (could not capture page text)",
      );
    }
    return false;
  } catch (e) {
    if (e.controlAbort || e.message.includes("Aborted (Web UI)")) throw e;
    logger.warn(`[DeepSeek Poll] Error: ${e.message}`);
    return false;
  } finally {
    eventBus.off("abort_requested", abortHandler);
    if (sessionId)
      eventBus.off(`session_control:${sessionId}`, controlAbortHandler);
  }
}
