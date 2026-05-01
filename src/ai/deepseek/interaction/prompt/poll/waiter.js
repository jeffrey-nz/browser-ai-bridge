import { logger } from "#utils/logger.js";
import { NetworkMonitor } from "#ai/shared/networkMonitor.js";
import {
  POLL_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  ABORT_CHECK_INTERVAL_MS,
} from "./constants.js";
import { runPreflightChecks } from "./setup.js";
import { PollAbortController } from "./abortController.js";
import { getDeepSeekDomState } from "./domState.js";
import { evaluateDeepSeekCompletion } from "./evaluator.js";

export async function waitForDeepSeekCompletion(
  page,
  initialMsgCount = 0,
  sessionId = null,
) {
  const abortController = new PollAbortController(sessionId);
  let networkMonitor = null;

  try {
    const { stopBtnSel, responseBlockSel, cfOverlaySel } =
      await runPreflightChecks(page);

    networkMonitor = new NetworkMonitor(page, "/chat/completion");

    await page.waitForTimeout(1500);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const stateContext = {
      lastTextLength: 0,
      stableIterations: 0,
      idleIterations: 0,
    };

    while (Date.now() < deadline) {
      abortController.check();

      try {
        const domState = await getDeepSeekDomState(
          page,
          cfOverlaySel,
          stopBtnSel,
          responseBlockSel,
        );

        if (domState.isBlocked) {
          logger.error(
            "🛑 CLOUDFLARE BLOCK DETECTED. DeepSeek is requesting human verification.",
          );
          return false;
        }

        // Rate-limit response text detected — throw a typed error so the
        // promptWorkflow outer catch returns { ok: false, rateLimited: true }
        // and the executor's backoff-and-retry logic kicks in automatically.
        if (domState.isRateLimited) {
          logger.warn(
            `[DeepSeek Poll] Rate-limit text detected in response — signalling caller for backoff retry.`,
          );
          const err = new Error(
            `DeepSeek rate limit: ${domState.currentText.slice(0, 120)}`,
          );
          err.rateLimited = true;
          throw err;
        }

        // Regenerate button means generation failed (server error, not rate
        // limit) — fail fast rather than burning the 300s timeout.
        if (domState.regenerateVisible) {
          logger.warn(
            "[DeepSeek Poll] Regenerate button visible — generation failed, failing fast.",
          );
          return false;
        }

        const isNetworkActive = networkMonitor.isStreamActive();
        domState.isGenerating = domState.isGenerating || isNetworkActive;

        const isComplete = evaluateDeepSeekCompletion(
          domState,
          stateContext,
          initialMsgCount,
        );

        if (isComplete && !isNetworkActive) {
          return true;
        }
      } catch (playwrightErr) {
        if (playwrightErr.controlAbort) throw playwrightErr;
        if (playwrightErr.rateLimited) throw playwrightErr;
        logger.trace(
          `[DeepSeek Poll] Transient error: ${playwrightErr.message}`,
        );
      }

      const sleepEnd = Date.now() + POLL_INTERVAL_MS;
      while (Date.now() < sleepEnd) {
        abortController.check();
        await new Promise((r) => setTimeout(r, ABORT_CHECK_INTERVAL_MS));
      }
    }

    logger.warn("[DeepSeek Poll] Timed out after 300s.");
    return false;
  } catch (e) {
    if (e.controlAbort || e.message.includes("Aborted")) throw e;
    if (e.rateLimited) throw e;
    logger.warn(`[DeepSeek Poll] Error: ${e.message}`);
    return false;
  } finally {
    if (networkMonitor) networkMonitor.cleanup();
    abortController.cleanup();
  }
}
