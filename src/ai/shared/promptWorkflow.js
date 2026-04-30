import { logger } from "#utils/logger.js";
import { createSpinner } from "#app/ui/spinner.js";
import { handlePromptError } from "#ai/shared/promptError/index.js";
import { dumpPageHtml } from "#ai/shared/domInteraction.js";

export async function runPromptWorkflow(page, text, label, options) {
  try {
    return await _runPromptWorkflowInner(page, text, label, options);
  } catch (err) {
    if (err.rateLimited) {
      logger.warn(
        `[Prompt Workflow] Rate limit detected for ${options.providerName}: ${err.message}`,
      );
      return { ok: false, rateLimited: true, reason: err.message };
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

  await injectText(page, text);
  await clickSend(page);

  let spinner = createSpinner(`${providerName} is thinking...`).start();
  let ok = await waitForCompletion(page, spinner);

  while (!ok) {
    spinner.fail(`${providerName} stalled, timed out, or was blocked.`);

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
      await injectText(page, text);
      await clickSend(page);
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
    return { ok: false, rateLimited: true, reason: "Rate limit detected in response body" };
  }

  onSuccess(responseText);
  return { ok: true, text: responseText };
}
