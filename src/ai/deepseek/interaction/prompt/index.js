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
  // T-048: the default "Instant" mode does not reliably read an attached
  // image — see mode.js's own comment on selectDeepSeekVisionMode for the
  // live evidence, and T-073's note there on what "not confirmed" actually
  // risks (a fabricated count, not a safe refusal). Every image turn needs
  // this, not just ones that ask for a specific mode, so it runs
  // unconditionally here rather than through the caller-facing setMode()
  // path.
  const visionMode = await selectDeepSeekVisionMode(page);
  logger.info(`[DeepSeek] Uploading file for visual analysis: ${filePath}`);
  let imageAttached = false;
  let imageAttachedCause;
  // T-053/T-058: see uploadFile.js's evidenceOut comment — evidenceSelectorUsed
  // is set before anything can throw, so imageAttachedEvidence below is not
  // gated behind imageAttached. `true` additionally gets the match details
  // (which alternative matched, requireGrowth/grew, elapsedMs, strategy) the
  // same way T-038 gave `false` its own cause.
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
    // T-058: ungated — see src/ai/generic/interaction.js's own comment.
    // An empty evidenceOut is filtered at the consumer, not here.
    ...(imageAttached ? {} : { imageAttachedCause }),
    imageAttachedEvidence: evidenceOut,
    // T-073: rides to the report JSON the same way imageAttached does —
    // see mode.js's own comment on the three verdict values.
    visionModeVerdict: visionMode.verdict,
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
