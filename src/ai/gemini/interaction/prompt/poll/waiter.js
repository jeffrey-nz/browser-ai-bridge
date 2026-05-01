import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import { getPollLocators, getDoneSignal } from "./locators.js";
import { checkSnackbarError } from "./errorMonitor.js";
import { evaluateCompletion } from "./evaluator.js";

export async function waitForGeminiCompletion(
  page,
  spinner,
  initialMessageCount,
) {
  const locators = getPollLocators(page);

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  eventBus.once("abort_requested", abortHandler);

  try {
    const state = { lastTextLength: 0, stableIterations: 0 };

    if (initialMessageCount > 0) {
      await page
        .waitForFunction(
          (count) => {
            const current = document.querySelectorAll(
              "model-response, response-container, message-content",
            ).length;
            return current > count;
          },
          initialMessageCount,
          { timeout: 45000 },
        )
        .catch(() => {});
    }

    // Selectors for Gemini's Canvas/artifact side panel and its close button.
    // Gemini sometimes creates a canvas when generating large code blocks, which
    // causes 200+ second delays and routes content outside the chat response.
    // We close it as soon as it appears to keep output in the main chat.
    const CANVAS_PANEL_SELECTORS = [
      "ms-artifact",
      "artifact-viewer",
      ".canvas-container",
      "[data-panel-type='code']",
      "bard-canvas",
      ".immersive-drawer",
    ].join(", ");
    const CANVAS_CLOSE_SELECTORS = [
      'button[aria-label*="Close canvas"]',
      'button[aria-label*="close canvas"]',
      'button[aria-label*="Close artifact"]',
      'button[aria-label*="Dismiss"]',
      ".canvas-container button[aria-label*='close'], .canvas-container button[aria-label*='Close']",
      "ms-artifact button[aria-label*='close'], ms-artifact button[aria-label*='Close']",
      "artifact-viewer button[aria-label*='close'], artifact-viewer button[aria-label*='Close']",
    ];

    let canvasDismissed = false;

    await pollUntil(
      async () => {
        if (aborted) throw new Error("Aborted (Web UI)");

        const errorState = await checkSnackbarError(locators.snackbar);
        if (errorState) throw new Error("ERROR_13");

        // Dismiss Gemini canvas/artifact panel if it opens — prevents 200+ second
        // generation delays from canvas content that the pipeline can't read anyway.
        if (!canvasDismissed) {
          const canvasVisible = await page
            .locator(CANVAS_PANEL_SELECTORS)
            .first()
            .isVisible({ timeout: 200 })
            .catch(() => false);

          if (canvasVisible) {
            for (const sel of CANVAS_CLOSE_SELECTORS) {
              const btn = page.locator(sel).first();
              if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
                await btn.click({ force: true }).catch(() => {});
                logger.info("[Gemini Poll] Canvas panel detected and dismissed");
                canvasDismissed = true;
                break;
              }
            }
            if (!canvasDismissed) {
              // Log once so we can discover the actual selector via screenshot
              logger.warn("[Gemini Poll] Canvas panel visible but no close button matched — generation may be slow");
              canvasDismissed = true; // avoid spamming
            }
          }
        }

        const isGenerating = await locators.stopBtn
          .isVisible()
          .catch(() => false);
        const doneSignal = getDoneSignal(locators.lastResponse);
        const isDone = await doneSignal.isVisible().catch(() => false);

        const currentTextLength = await locators.lastResponse
          .innerText()
          .then((t) => t.length)
          .catch(() => 0);

        const isComplete = evaluateCompletion(
          isGenerating,
          isDone,
          currentTextLength,
          state,
        );

        if (isComplete) {
          await page.waitForTimeout(1000);
          return true;
        }

        state.lastTextLength = currentTextLength;
        return false;
      },
      { timeoutMs: 420000, pollIntervalMs: 500, errorMessage: "TIMEOUT" },
    );

    return "SUCCESS";
  } catch (e) {
    if (e.message.includes("Aborted")) throw e;
    if (e.message === "ERROR_13") return "ERROR_13";
    if (e.message.includes("TIMEOUT")) {
      logger.warn(`[Gemini Poll] Timeout reached`);
      return "TIMEOUT";
    }
    logger.warn(`[Gemini Poll] Polling failed: ${e.message}`);
    return "ERROR";
  } finally {
    eventBus.off("abort_requested", abortHandler);
  }
}
