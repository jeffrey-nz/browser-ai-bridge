import crypto from "node:crypto";
import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import { getPollLocators, getDoneSignal } from "./locators.js";
import { checkSnackbarError } from "./errorMonitor.js";
import { evaluateCompletion } from "./evaluator.js";

// Screenshot-based stall detection: every SHOT_INTERVAL_MS we hash a
// screenshot of the page. While Gemini is genuinely working the page changes
// (streaming text, animating spinner), so an unchanged screenshot for
// SHOT_STALL_MS means the tab is visually frozen — a wedged turn.
const SHOT_INTERVAL_MS = 15000;
const SHOT_STALL_MS = 120000;

async function _screenshotHash(page) {
  try {
    const buf = await page.screenshot({ type: "png", fullPage: false });
    return crypto.createHash("sha1").update(buf).digest("hex");
  } catch {
    return null;
  }
}

export async function waitForGeminiCompletion(
  page,
  spinner,
  initialMessageCount,
  sessionId = null,
) {
  const locators = getPollLocators(page);

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  eventBus.once("abort_requested", abortHandler);

  // Session-specific abort: fires when the HTTP client disconnects mid-poll
  // (e.g. the caller's fetch AbortController or a Stop in the dashboard). Until
  // now Gemini ignored this — only the never-emitted global abort_requested was
  // wired — so an in-flight turn could not be interrupted.
  let sessionAbortHandler = null;
  if (sessionId) {
    sessionAbortHandler = () => {
      aborted = true;
    };
    eventBus.once(`session_abort:${sessionId}`, sessionAbortHandler);
  }

  try {
    const state = {
      lastTextLength: 0,
      stableIterations: 0,
      lastChangeMs: Date.now(),
      shotHash: null,
      shotChangeMs: Date.now(),
      lastShotMs: 0,
    };
    // If the response text neither grows nor settles for this long, the turn
    // is wedged (stuck "generating", canvas glitch, dead session) — bail early
    // rather than holding the caller for the full poll timeout.
    const NO_PROGRESS_STALL_MS = 240000;

    if (initialMessageCount > 0) {
      await page
        .waitForFunction(
          ({ count, errTexts }) => {
            // Bail early if "Something went wrong" snackbar appears — no point
            // waiting 45s for a response that will never come.
            const snackbar = document.querySelector(
              "bard-simple-snack-bar, .mat-mdc-simple-snack-bar",
            );
            if (snackbar && snackbar.offsetParent !== null) {
              const txt = (snackbar.textContent || "").toLowerCase();
              if (errTexts.some((t) => txt.includes(t))) return true;
            }
            return (
              document.querySelectorAll(
                "model-response, response-container, message-content",
              ).length > count
            );
          },
          {
            count: initialMessageCount,
            errTexts: ["something went wrong", "(13)"],
          },
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
                logger.info(
                  "[Gemini Poll] Canvas panel detected and dismissed",
                );
                canvasDismissed = true;
                break;
              }
            }
            if (!canvasDismissed) {
              // Log once so we can discover the actual selector via screenshot
              logger.warn(
                "[Gemini Poll] Canvas panel visible but no close button matched — generation may be slow",
              );
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

        // Stall guard A — response text: if it neither grows nor settles for
        // NO_PROGRESS_STALL_MS, the turn is wedged.
        if (currentTextLength !== state.lastTextLength) {
          state.lastChangeMs = Date.now();
        } else if (Date.now() - state.lastChangeMs > NO_PROGRESS_STALL_MS) {
          // Text frozen for the stall window. If a real answer is on screen
          // this is a finished turn whose Stop button never cleared — accept
          // it rather than discarding the response and forcing a retry.
          if (currentTextLength > 0) {
            logger.info(
              "[Gemini Poll] Response settled but Stop button never cleared — accepting it",
            );
            await page.waitForTimeout(500);
            return true;
          }
          logger.warn("[Gemini Poll] No response progress — treating as stalled");
          throw new Error("TIMEOUT");
        }

        // Stall guard B — screenshot: while Gemini is still "generating" the
        // page should be changing visually. If a screenshot is byte-identical
        // for SHOT_STALL_MS while still generating, the tab is frozen.
        if (isGenerating && Date.now() - state.lastShotMs > SHOT_INTERVAL_MS) {
          state.lastShotMs = Date.now();
          const hash = await _screenshotHash(page);
          if (hash) {
            if (hash !== state.shotHash) {
              state.shotHash = hash;
              state.shotChangeMs = Date.now();
            } else if (Date.now() - state.shotChangeMs > SHOT_STALL_MS) {
              // Frozen tab. If a response is already written, salvage it
              // instead of throwing it away — a stuck Stop button shouldn't
              // cost the user a completed answer.
              if (currentTextLength > 0) {
                logger.info(
                  "[Gemini Poll] Page frozen but a response is present — accepting it",
                );
                await page.waitForTimeout(500);
                return true;
              }
              logger.warn(
                "[Gemini Poll] Page visually frozen while generating — treating as stalled",
              );
              throw new Error("TIMEOUT");
            }
          }
        } else if (!isGenerating) {
          // Not generating — reset the visual-stall clock so a static, settled
          // page is never mistaken for a freeze.
          state.shotChangeMs = Date.now();
          state.shotHash = null;
        }

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
      { timeoutMs: 900000, pollIntervalMs: 500, errorMessage: "TIMEOUT" },
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
    if (sessionId && sessionAbortHandler) {
      eventBus.off(`session_abort:${sessionId}`, sessionAbortHandler);
    }
  }
}
