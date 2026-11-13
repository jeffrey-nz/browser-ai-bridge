import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";
import { pollUntil } from "#utils/poller.js";
import {
  readLimitSeconds,
  limitNotice,
  describeLimit,
  UNKNOWN_LIMIT_SECONDS,
} from "#ai/shared/usageLimit.js";
import { GROK_LOCATORS as L } from "#ai/grok/locators.js";

const RATE_LIMIT_SEL =
  'div.text-primary:has-text("Message limit reached"), ' +
  'button:has-text("SuperGrok"), ' +
  "div.bg-card:has(svg.lucide-triangle-alert)";

/**
 * `prevCount` is how many assistant answers the page held before the send.
 * The poll waits for a NEW one: a reused conversation still shows the last
 * turn's answer and its "Copy response" toolbar, and reading those (as the
 * old `.message-bubble` last-match did) returned the previous answer, or the
 * user's own prompt, the instant the poll started.
 */
export async function waitForGrokCompletion(page, prevCount = null) {
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
          //[[ GROK PRINTS HOW LONG THE LIMIT LASTS. READ IT.
          //
          //   This branch used to detect the limit and discard the only useful
          //   thing on the page. Measured 2026-09-24, grok.com showed
          //   "18 hours 49 minutes before limit is gone" — a DAILY quota — and
          //   the only cooldown applied anywhere was the client's flat five
          //   minutes. The tab list proved the cost: ten grok tabs, countdowns
          //   18h49m, 18h50m … 18h56m, one per minute, each a new tab and a
          //   full wasted turn to relearn what the first page had printed.
          //
          //   Attaching the seconds here is what lets cooldownManager hold grok
          //   off for the real span, which in turn makes skipTier() skip it
          //   BEFORE a tab is opened — so the pile-up stops at its cause. ]]
          const seconds = await readLimitSeconds(page).catch(
            () => UNKNOWN_LIMIT_SECONDS,
          );
          const body = await page
            .evaluate(() => document.body?.innerText || "")
            .catch(() => "");
          const notice = limitNotice(body);
          const err = new Error(
            describeLimit("Grok", seconds ?? UNKNOWN_LIMIT_SECONDS, notice),
          );
          err.rateLimited = true;
          err.cooldownSeconds = seconds ?? UNKNOWN_LIMIT_SECONDS;
          err.limitNotice = notice;
          throw err;
        }

        const answers = page.locator(L.assistantMessage);
        const count = await answers.count().catch(() => 0);
        if (prevCount !== null && count <= prevCount) {
          lastTextLength = 0;
          stableIterations = 0;
          return false;
        }
        const lastAnswer = answers.last();
        // One evaluate, so a missing markdown body cannot stall on Playwright's
        // auto-wait: the answer's body if present, else the bubble's own text.
        const currentText = await lastAnswer
          .evaluate((el) => {
            const md = el.querySelectorAll(".response-content-markdown");
            const body = md.length ? md[md.length - 1] : el;
            return body.innerText || "";
          })
          .catch(() => "");

        // The done toolbar of THIS answer's turn, not of an earlier one.
        const lastTurn = page
          .locator(L.messageTurn)
          .filter({ has: page.locator(L.assistantMessage) })
          .last();
        const doneInTurn = await lastTurn
          .locator(L.doneSignal)
          .first()
          .isVisible()
          .catch(() => false);
        const stopVisible = await page
          .locator(L.stopBtn)
          .last()
          .isVisible()
          .catch(() => false);
        const isDoneSignalVisible = doneInTurn && !stopVisible;

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
