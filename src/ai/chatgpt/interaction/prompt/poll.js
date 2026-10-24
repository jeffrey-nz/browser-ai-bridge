import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import { logger } from "#utils/logger.js";
import { TOO_MANY_REQUESTS_SEL } from "../chat.js";
import { CHATGPT_DOM } from "../../locators.js";
import {
  readChatGptDom,
  readChatGptConversationApi,
  decideChatGptPoll,
} from "./dom.js";

const RATE_LIMIT_SEL =
  '.text-token-text-secondary:has-text("message limit"), ' +
  'div:has-text("You\'ve reached your message limit")';

const API_EVERY_MS = 3000;

/** The error a run fails with when a strategy list stops matching. */
function domChangedError(which, snap) {
  const list =
    which === "user turn" ? CHATGPT_DOM.user : CHATGPT_DOM.assistant; // "assistant reply" / "assistant reply text"
  const err = new Error(
    `provider DOM changed: ${which} (none of: ${list.join(" | ")}; matched ${JSON.stringify(snap?.matched || {})}) — update src/ai/chatgpt/locators.js`,
  );
  err.domChanged = true;
  err.terminal = true; // pollUntil must not swallow it and poll on, blind
  return err;
}

/**
 * Wait for the reply to the prompt just sent.
 * @param {object} baseline  captureChatGptBaseline() from BEFORE the send
 */
export async function waitForChatGptCompletion(
  page,
  baseline,
  sessionId = null,
) {
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

    const st = {
      baseline,
      lastLen: 0,
      stable: 0,
      sentAt: baseline.sentAt || Date.now(),
      lastApiAt: 0,
    };

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

        const snap = await readChatGptDom(
          page,
          baseline.assistantIds || [],
          baseline.assistantCount || 0,
        );

        // The conversation API is a second witness, read every few seconds
        // rather than every tick: it is the fallback when the DOM is blind.
        let api = null;
        if (snap.conversationId && Date.now() - st.lastApiAt > API_EVERY_MS) {
          st.lastApiAt = Date.now();
          api = await readChatGptConversationApi(page);
        }

        const verdict = decideChatGptPoll(st, snap, api, Date.now());
        if (snap.newReplyId) page.__chatgptReplyId = snap.newReplyId; // for the extractor
        if (verdict.domChanged) throw domChangedError(verdict.domChanged, snap);
        if (verdict.done) {
          if (verdict.source === "api") {
            logger.warn(
              `[ChatGPT Poll] provider DOM changed: assistant reply (none of: ${CHATGPT_DOM.assistant.join(" | ")}) — answered from the conversation API instead. Update src/ai/chatgpt/locators.js.`,
            );
            page.__chatgptApiReply = verdict.text;
          }
          return true;
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
    if (e.domChanged) throw e;
    logger.warn(`[ChatGPT Poll] Error or Timeout: ${e.message}`);
    return false;
  } finally {
    eventBus.off("abort_requested", abortHandler);
    if (sessionId && sessionAbortHandler) {
      eventBus.off(`session_abort:${sessionId}`, sessionAbortHandler);
    }
  }
}
