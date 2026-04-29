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

    await pollUntil(
      async () => {
        if (aborted) throw new Error("Aborted (Web UI)");

        const errorState = await checkSnackbarError(locators.snackbar);
        if (errorState) throw new Error("ERROR_13");

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
