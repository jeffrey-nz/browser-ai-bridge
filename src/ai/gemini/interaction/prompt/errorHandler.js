import { logger } from "#utils/logger.js";
import { cooldownManager } from "../../../../session/CooldownManager.js";
import { handlePromptError } from "#ai/shared/promptError/index.js";
import { capturePageSnapshot } from "#ai/shared/captureSnapshot.js";
import { dumpPageHtml } from "#ai/shared/domInteraction.js";

const QUEUED_COOLDOWN_S = 300;

export async function handleGeminiError(err, page) {
  if (err.spinner) {
    err.spinner.stop();
  }

  if (err.message && err.message.includes("Aborted")) {
    throw err;
  }

  //[[ A QUEUED TURN IS NOT A BROKEN PAGE. It goes straight back to the caller
  //   with its own words and a short cooldown — never into the generic recovery
  //   below, whose rate-limit back-off would RE-SUBMIT a prompt Google is still
  //   holding. See the QUEUED note in poll/waiter.js. ]]
  if (err.queued) {
    cooldownManager.trigger("gemini", QUEUED_COOLDOWN_S, err.message);
    const e = new Error(err.message);
    e.stalled = true;
    e.cooldownSeconds = QUEUED_COOLDOWN_S;
    throw e;
  }

  try {
    const htmlDump = await dumpPageHtml(page);
    logger.debug({ htmlDump }, "[Gemini Error] DOM Dump");
  } catch (e) {}

  if (err.isUiError || err.message === "GEMINI_SNACKBAR_ERROR_13") {
    logger.error("⚠️ GEMINI UI ERROR 13 DETECTED");
    await capturePageSnapshot(page, `Gemini UI Error 13`);

    cooldownManager.trigger("gemini", 120);

    return {
      action: "return",
      result: {
        ok: false,
        needsRotation: true,
        rateLimited: true,
        reason: "Gemini UI Error (13) - Forced Cooldown applied",
      },
    };
  }

  await capturePageSnapshot(page, `Send Failure: ${err.message}`);

  const errorOpts = {
    includeKeepWaiting: true,
    useDashboard: true,
    timeoutMs: 120000,
  };

  const recovery = await handlePromptError(
    err,
    page,
    err.spinner,
    {},
    errorOpts,
  );

  if (recovery?.action === "return") {
    return { action: "return", result: recovery.result };
  }

  if (
    recovery?.action !== "retry_same" &&
    recovery?.action !== "keep_waiting"
  ) {
    cooldownManager.trigger("gemini", 120);
    return {
      action: "return",
      result: {
        ok: false,
        needsRotation: true,
        reason: `Fatal Interaction Error: ${err.message}`,
      },
    };
  }

  return recovery;
}
