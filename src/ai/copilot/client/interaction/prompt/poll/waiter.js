import { logger } from "#utils/logger.js";
import { scrapeProgressText } from "./scraper.js";
import { getPollLocators } from "./locators.js";
import { createErrorMonitor } from "./errorMonitor.js";
import { pollDomState } from "./state.js";
import { evaluateCompletion } from "./evaluator.js";
import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import { randomUUID } from "node:crypto";
import { createPollState } from "./timer.js";
import { COPILOT_365_LOCATORS } from "../../../locators.js";

const WIDGET_SELECTOR = [
  COPILOT_365_LOCATORS.pageWidget,
  COPILOT_365_LOCATORS.designerImageFrame,
].join(", ");

async function checkWidgetVisible(page) {
  return page
    .locator(WIDGET_SELECTOR)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

export async function waitForCompletion(
  page,
  submitResult = {},
  spinner = null,
  sessionId = null,
  pollTimeoutMs = 420000,
) {
  const previousText =
    typeof submitResult === "string"
      ? submitResult
      : submitResult?.previousText || "";
  const previousCount =
    typeof submitResult === "object" ? submitResult?.previousCount || 0 : 0;

  const state = createPollState(pollTimeoutMs);
  const locators = getPollLocators(page);
  const errorMonitor = createErrorMonitor();
  const messageId = randomUUID();

  let aborted = false;
  let controlAborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  const controlAbortHandler = (result) => {
    if (result?.action === "keep_waiting") return;
    controlAborted = true;
    aborted = true;
  };
  eventBus.once("abort_requested", abortHandler);
  if (sessionId) {
    eventBus.on(`session_control:${sessionId}`, controlAbortHandler);
  }

  try {
    let turnStarted = false;
    for (let i = 0; i < 25; i++) {
      if (controlAborted) {
        const err = new Error("CONTROL_ABORT: poll aborted by control signal");
        err.controlAbort = true;
        throw err;
      }
      if (aborted) throw new Error("Aborted (Web UI)");
      const dom = await pollDomState(page, locators);

      if (dom.isGenerating || dom.currentCount > previousCount) {
        turnStarted = true;
        break;
      }
      await page.waitForTimeout(800);
    }

    if (!turnStarted) {
      logger.warn(
        "[Copilot Poll] UI hasn't confirmed turn start. Proceeding to observation...",
      );
    }

    return await pollUntil(
      async () => {
        if (controlAborted) {
          const err = new Error(
            "CONTROL_ABORT: poll aborted by control signal",
          );
          err.controlAbort = true;
          throw err;
        }
        if (aborted) throw new Error("Aborted (Web UI)");

        const domState = await pollDomState(page, locators);

        if (await errorMonitor.check(page)) {
          eventBus.emit("message_complete", { text: "", messageId });
          return true;
        }

        if (domState.currentText.length !== state.lastTextLength) {
          state.lastTextLength = domState.currentText.length;
          state.lastChangeTime = Date.now();
        }

        if (domState.currentText.length > state.lastEmittedLength) {
          const chunk = domState.currentText.slice(state.lastEmittedLength);
          eventBus.emit("message_chunk", { text: chunk, messageId });
          state.lastEmittedLength = domState.currentText.length;
        }

        const isActuallyDone = evaluateCompletion(
          domState,
          previousText,
          previousCount,
        );
        state.notGeneratingStreak = domState.isGenerating
          ? 0
          : state.notGeneratingStreak + 1;

        if (
          isActuallyDone &&
          state.notGeneratingStreak >= state.NOT_GENERATING_REQUIRED
        ) {
          if (domState.currentText.trim().length > 0 || domState.isRefused) {
            eventBus.emit("message_complete", {
              text: domState.currentText,
              messageId,
            });
            return true;
          }

          // Done signal fired but no text — Copilot may have created a widget
          // instead of a chat reply. Complete early with empty text so the
          // response validator can detect the widget and trigger correction.
          if (await checkWidgetVisible(page)) {
            logger.warn(
              "[Copilot Poll] Done signal with no text — widget detected. Completing for validator.",
            );
            eventBus.emit("message_complete", { text: "", messageId });
            return true;
          }
        }

        // Fallback completion: if the AI has stopped generating and produced
        // non-empty text that is stable for 8+ consecutive poll ticks (~8s),
        // declare done even if the "done" button selectors didn't fire. This
        // handles cases where Copilot 365's DOM structure changed and the copy-
        // button / message-count selectors no longer match the current UI.
        if (
          state.notGeneratingStreak >= 8 &&
          domState.currentText.trim().length > 0
        ) {
          logger.warn(
            "[Copilot Poll] Completion detected via non-generating streak — done selectors may be stale.",
          );
          eventBus.emit("message_complete", {
            text: domState.currentText,
            messageId,
          });
          return true;
        }

        // When the AI is generating but there's no visible text output (e.g. it's
        // building a widget), cap the stall wait at 90s so widget correction kicks
        // in faster. For normal text responses the poller exits via evaluateCompletion.
        const stallThreshold =
          domState.currentText.trim().length === 0 ? 90000 : 180000;
        if (
          domState.isGenerating &&
          Date.now() - state.lastChangeTime > stallThreshold
        ) {
          logger.warn(
            `[Copilot Stall] Generation inactive for ${stallThreshold / 1000}s. Forcing capture.`,
          );
          eventBus.emit("message_complete", {
            text: domState.currentText,
            messageId,
          });
          return true;
        }

        // When the AI never started generating (no stop button, no new text, no
        // done signal), stall after 120s so the retry mechanism can kick in rather
        // than hanging until the 7-minute poll timeout.
        if (
          !domState.isGenerating &&
          !domState.isDone &&
          !domState.isRefused &&
          domState.currentText.trim() === "" &&
          Date.now() - state.lastChangeTime > 120000
        ) {
          logger.warn(
            "[Copilot Stall] AI never started generating after 120s. Treating as stall.",
          );
          eventBus.emit("message_complete", { text: "", messageId });
          return true;
        }

        if (spinner && domState.isGenerating) {
          const statusText = await scrapeProgressText(page);
          if (statusText && statusText !== state.lastStatus) {
            state.lastStatus = statusText;
            spinner.update(`AI: ${statusText}`);
          }
        }

        return false;
      },
      {
        timeoutMs: state.timeoutMs,
        pollIntervalMs: 1000,
        errorMessage: "Copilot polling timeout reached",
      },
    );
  } catch (e) {
    if (e.controlAbort || e.message.includes("Aborted")) throw e;
    logger.error(`[Copilot Poll] Error: ${e.message}`);
    eventBus.emit("message_complete", { text: "", messageId });
    return false;
  } finally {
    eventBus.off("abort_requested", abortHandler);
    if (sessionId) {
      eventBus.off(`session_control:${sessionId}`, controlAbortHandler);
    }
  }
}
