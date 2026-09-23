import { logger } from "#utils/logger.js";
import { createSpinner } from "#app/ui/spinner.js";
import { handlePromptError } from "#ai/shared/promptError/index.js";
import { dumpPageHtml } from "#ai/shared/domInteraction.js";
import {
  diagnoseBlockedPage,
  describeBlock,
} from "#ai/shared/blockedPage.js";
import { cooldownManager } from "../../session/CooldownManager.js";

export async function runPromptWorkflow(page, text, label, options) {
  try {
    return await _runPromptWorkflowInner(page, text, label, options);
  } catch (err) {
    if (err.suspended) {
      // A suspension has a stated end time and is already on the cooldown
      // store; the chain must skip this provider, not wait on it.
      logger.error(
        `[Prompt Workflow] ${options.providerName} is SUSPENDED — on cooldown. ${err.message}`,
      );
      return {
        ok: false,
        rateLimited: true,
        suspended: true,
        reason: err.message,
      };
    }
    if (err.signedOut) {
      // Distinct from a rate limit: a rate limit clears on its own, this one
      // needs a human to log in. Carried as rateLimited too so the executor's
      // existing "skip this provider" path applies without change.
      logger.error(
        `[Prompt Workflow] ${options.providerName} is SIGNED OUT — skipping it. ${err.message}`,
      );
      return {
        ok: false,
        rateLimited: true,
        signedOut: true,
        reason: err.message,
      };
    }
    if (err.rateLimited) {
      logger.warn(
        `[Prompt Workflow] Rate limit detected for ${options.providerName}: ${err.message}`,
      );
      //[[ A LIMIT THAT STATED ITS OWN LENGTH IS RECORDED, NOT JUST REPORTED.
      //
      //   src/routes/ask/tiers.js names the precondition for wiring a provider
      //   into cooldownManager: "If chatgpt/deepseek get a real per-provider TTL
      //   from a measured source, wire it through WRITABLE_PROVIDERS in the same
      //   commit that adds it here." `err.cooldownSeconds` IS that source — it is
      //   set only where a provider printed its own countdown (grok's poll reads
      //   "18 hours 49 minutes before limit is gone"), never guessed here. A
      //   rate limit with no stated span still records nothing, exactly as
      //   before, because an unargued constant was the thing that decision
      //   refused.
      //
      //   Recording it is what stops the pile-up rather than merely reporting
      //   it: skipTier() reads cooldownManager, so the next request skips the
      //   provider BEFORE opening a tab. Ten grok tabs a minute apart, each a
      //   wasted turn against a nineteen-hour limit, was the cost of returning
      //   this fact and storing none of it. ]]
      if (Number.isFinite(err.cooldownSeconds) && err.cooldownSeconds > 0) {
        cooldownManager.trigger(
          String(options.providerName || "").toLowerCase(),
          err.cooldownSeconds,
          err.limitNotice || err.message,
        );
      }
      return {
        ok: false,
        rateLimited: true,
        reason: err.message,
        ...(err.cooldownSeconds ? { cooldownSeconds: err.cooldownSeconds } : {}),
      };
    }
    if (err.busyGenerating) {
      logger.warn(
        `[Prompt Workflow] DeepSeek busy (still generating) for ${options.providerName}: ${err.message}`,
      );
      return { ok: false, busyGenerating: true, reason: err.message };
    }
    throw err;
  }
}

async function _runPromptWorkflowInner(page, text, label, options) {
  const {
    providerName,
    injectText,
    clickSend,
    waitForCompletion,
    extractResponse,
    onSuccess = () => {},
    onFailure = (msg) => ({
      ok: false,
      text: msg || "Validation failed (empty response)",
    }),
  } = options;

  logger.info(`🚀 Injecting ${label} (${providerName})...`);
  logger.trace(
    { type: "outbound", provider: providerName, label, text },
    "Outbound prompt injected",
  );

  await _injectAndSendWithRecovery(
    page,
    text,
    injectText,
    clickSend,
    providerName,
  );

  let spinner = createSpinner(`${providerName} is thinking...`).start();
  let ok = await waitForCompletion(page, spinner);

  const RATE_LIMIT_RE =
    /messages?\s+are\s+too\s+frequent|rate\s+limit|too\s+many\s+requests/i;

  while (!ok) {
    spinner.fail(`${providerName} stalled, timed out, or was blocked.`);

    // Before opening the interactive recovery dashboard, attempt an early
    // extraction. Two cases:
    // 1. Rate-limit message: surface as rateLimited so the executor's backoff
    //    handles it instead of blocking on a human operator prompt.
    // 2. Valid response despite poll timeout: return success directly. This
    //    handles broken stop-button locators where generation completed but
    //    the poll loop never detected the stop button appearing/disappearing.
    try {
      const earlyText = await extractResponse(page);
      if (earlyText && RATE_LIMIT_RE.test(earlyText)) {
        logger.warn(
          `[Prompt Workflow] Rate-limit text found on early extraction — bypassing manual recovery.`,
        );
        return {
          ok: false,
          rateLimited: true,
          reason: "Rate limit detected on early extraction",
        };
      }
      if (earlyText && earlyText.trim().length >= 50) {
        logger.info(
          `[Prompt Workflow] Valid response found on early extraction after poll timeout (${earlyText.trim().length} chars) — using it.`,
        );
        onSuccess(earlyText);
        return { ok: true, text: earlyText };
      }
    } catch (_e) {
      // ignore — fall through to normal recovery
    }

    try {
      const htmlDump = await dumpPageHtml(page);
      logger.debug({ htmlDump }, "[Prompt Workflow] Timeout/Stall DOM Dump");
    } catch (e) {}

    const recovery = await handlePromptError(
      new Error("Timeout or UI Stall"),
      page,
      spinner,
      {},
      { includeKeepWaiting: true, useDashboard: true, timeoutMs: 120000 },
    );

    if (recovery.action === "keep_waiting") {
      spinner = createSpinner(`${providerName} is thinking...`).start();
      ok = await waitForCompletion(page, spinner);
    } else if (recovery.action === "retry_same") {
      logger.info("[RETRY] Re-injecting prompt content...");
      await _injectAndSendWithRecovery(
        page,
        text,
        injectText,
        clickSend,
        providerName,
      );
      spinner = createSpinner(`${providerName} is thinking...`).start();
      ok = await waitForCompletion(page, spinner);
    } else if (recovery.action === "return") {
      return recovery.result;
    } else {
      return onFailure("Timeout or UI Stall");
    }
  }

  await page.waitForTimeout(1000);
  spinner.succeed(`Response received.`);

  const responseText = await extractResponse(page);

  logger.trace(
    { type: "inbound", provider: providerName, text: responseText },
    "Inbound response received",
  );

  if (!responseText || responseText.length < 2) {
    logger.warn(
      `Empty response from ${providerName}. Returning synthetic nudge target.`,
    );
    return {
      ok: true,
      text: "[EMPTY_RESPONSE] The AI returned no content. Please output your next JSON tool array now inside a fenced ```json block.",
    };
  }

  // Rate-limit detection: the provider returned a "too frequent" error in the
  // response body rather than as a network/HTTP error. Signal the caller to
  // wait and retry — the caller can restart with a fresh extraction context.
  const RATE_LIMIT_PATTERNS = [
    /messages? are too frequent/i,
    /rate limit/i,
    /too many requests/i,
  ];
  const isRateLimited = RATE_LIMIT_PATTERNS.some((re) => re.test(responseText));
  if (isRateLimited) {
    logger.warn(
      `[Prompt Workflow] ${providerName} rate-limit response detected in response body — signalling caller.`,
    );
    return {
      ok: false,
      rateLimited: true,
      reason: "Rate limit detected in response body",
    };
  }

  // Busy-generating detection: DeepSeek returned this in the response body
  // when a prior generation was still in flight during submission.
  if (/a message is being generated/i.test(responseText)) {
    logger.warn(
      `[Prompt Workflow] ${providerName} busy-generating response detected in response body — signalling caller.`,
    );
    return {
      ok: false,
      busyGenerating: true,
      reason: "Busy generating detected in response body",
    };
  }

  onSuccess(responseText);
  return { ok: true, text: responseText };
}

// A submission failure (input field never cleared, button click did not trigger
// the chat) usually means the page is in a stuck state — a stale modal, a
// transient script error, or an unfocused composer. Reloading the tab almost
// always recovers without needing the cycle-mode fallback to a different
// provider. We only retry once; persistent failure escalates to the caller.
//
// We also recover when the input element itself was unresolvable — Playwright
// raises "waiting for locator", "Timeout exceeded", or selector errors when
// the composer DOM was swapped underneath us (auth modal, paywall, route
// change). A page reload puts the composer back.
const RECOVERABLE_RE =
  /Failed to submit prompt|waiting for locator|Timeout .* exceeded|element is not (visible|attached)|Target (page|frame).* has been closed/i;

async function _injectAndSendWithRecovery(
  page,
  text,
  injectText,
  clickSend,
  providerName,
) {
  try {
    await injectText(page, text);
    await clickSend(page);
    return;
  } catch (err) {
    const msg = err.message || "";
    const isRecoverable = RECOVERABLE_RE.test(msg);
    if (!isRecoverable) throw err;

    //[[ A reload fixes a half-loaded page. It does not fix a suspended account or
    //   a sign-in wall, and retrying one costs a full locator timeout plus the
    //   backoff, every turn, for as long as the block lasts. Ask the page which
    //   it is before spending that. ]]
    const blocked = await diagnoseBlockedPage(page).catch(() => null);
    if (blocked) {
      const reason = describeBlock(providerName, blocked);
      if (blocked.kind === "suspended") {
        // The notice states when it ends, so hold the provider off for exactly
        // that long instead of meeting the same wall on the next turn.
        cooldownManager.trigger(providerName.toLowerCase(), blocked.seconds);
      }
      const e = new Error(reason);
      e.rateLimited = true;
      if (blocked.kind === "suspended") e.suspended = true;
      else e.signedOut = true;
      throw e;
    }

    logger.warn(
      `[Prompt Workflow] ${providerName} submission failed (${msg.split("\n")[0]}) — reloading page and retrying once.`,
    );

    if (page.isClosed && page.isClosed()) {
      // Cannot reload a closed page. Surface the failure so the caller can
      // open a fresh session via the cycle-mode fallback.
      throw new Error(
        `${providerName} page was closed during submission — caller must recreate session`,
      );
    }

    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(2500);
    } catch (reloadErr) {
      logger.warn(
        `[Prompt Workflow] page.reload() failed: ${reloadErr.message} — retry will likely fail.`,
      );
    }

    await injectText(page, text);
    await clickSend(page);
  }
}
