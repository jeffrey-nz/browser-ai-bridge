import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import {
  injectDeepSeekText,
  clickDeepSeekSend,
  uploadFileToDeepSeek,
} from "./input.js";
import { waitForDeepSeekCompletion } from "./poll/index.js";
import { extractDeepSeekResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { resolveSelector } from "#ai/shared/locatorEngine.js";
import { DEEPSEEK_LOCATORS } from "../../locators.js";
import { logger } from "#utils/logger.js";
import { classifyUploadError } from "#ai/shared/uploadOutcome.js";
import { selectDeepSeekVisionMode } from "../mode.js";

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
  sessionId = null,
) {
  // T-048: the default "Instant" mode cannot read an attached image at all
  // — see mode.js's own comment on selectDeepSeekVisionMode for the live
  // evidence. Every image turn needs this, not just ones that ask for a
  // specific mode, so it runs unconditionally here rather than through the
  // caller-facing setMode() path.
  await selectDeepSeekVisionMode(page);
  logger.info(`[DeepSeek] Uploading file for visual analysis: ${filePath}`);
  let imageAttached = false;
  let imageAttachedCause;
  // T-053: see uploadFile.js's evidenceOut comment — a `true` gets a cause
  // (which alternative matched, requireGrowth/grew, elapsedMs, strategy)
  // the same way T-038 gave `false` one.
  const evidenceOut = {};
  try {
    imageAttached = await uploadFileToDeepSeek(page, filePath, evidenceOut);
  } catch (err) {
    imageAttachedCause = classifyUploadError(err);
    logger.warn(
      `[DeepSeek] File upload failed (${imageAttachedCause}): ${err.message} — sending text-only`,
    );
  }
  if (!imageAttached) {
    logger.warn(
      `[DeepSeek] Upload could not be confirmed — sending text-only, caller should not trust a visual answer.`,
    );
  }
  const result = await sendPromptAndWait(page, text, label, sessionId);
  return {
    ...result,
    imageAttached,
    ...(imageAttached
      ? { imageAttachedEvidence: evidenceOut }
      : { imageAttachedCause }),
  };
}

export async function sendPromptAndWait(
  page,
  text,
  label = "Prompt",
  sessionId = null,
) {
  // Count AI-response blocks only (.ds-markdown is AI-only, not user messages).
  // Use the same count for both the poll loop and the extractor so user messages
  // typed into the input are never mistaken for new AI responses.
  const initialAiBlockCount = await page
    .locator(".ds-markdown")
    .count()
    .catch(() => 0);

  return runPromptWorkflow(page, text, label, {
    providerName: "DeepSeek",
    injectText: injectDeepSeekText,
    clickSend: clickDeepSeekSend,
    waitForCompletion: async (pg, spinner) =>
      waitForDeepSeekCompletion(pg, initialAiBlockCount, sessionId),
    extractResponse: (pg) => extractDeepSeekResponse(pg, initialAiBlockCount),
    onFailure: (msg) => {
      log(
        colors.yellow(
          "Action: Check Chrome for Cloudflare or a 'Server Busy' message.",
        ),
      );
      return { ok: false, text: msg || "Timeout, Blocked, or Empty Response" };
    },
  });
}
