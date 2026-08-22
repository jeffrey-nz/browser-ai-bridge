import { printResponseSummary } from "#copilot/client/interaction/prompt/summary.js";
import { executePromptTurn, resumePolling } from "./executeTurn.js";
import { handleGeminiError } from "./errorHandler.js";
import { uploadFileToGemini } from "./input.js";
import { logger } from "#utils/logger.js";
import { classifyUploadError } from "#ai/shared/uploadOutcome.js";

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
  sessionId = null,
) {
  logger.info(`[Gemini] Uploading file for visual analysis: ${filePath}`);
  let imageAttached = false;
  let imageAttachedCause;
  // T-053/T-058: see uploadFile.js's evidenceOut comment — evidenceSelectorUsed
  // is set before anything can throw, so imageAttachedEvidence below is not
  // gated behind imageAttached.
  const evidenceOut = {};
  try {
    imageAttached = await uploadFileToGemini(page, filePath, evidenceOut);
  } catch (err) {
    imageAttachedCause = classifyUploadError(err);
    logger.warn(
      `[Gemini] File upload failed (${imageAttachedCause}): ${err.message} — sending text-only`,
    );
  }
  if (!imageAttached) {
    logger.warn(
      `[Gemini] Upload could not be confirmed — sending text-only, caller should not trust a visual answer.`,
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
  };
}

export async function sendPromptAndWait(
  page,
  initialText,
  initialLabel = "Prompt",
  sessionId = null,
) {
  let text = initialText;
  let label = initialLabel;
  let action = "retry_same";

  while (true) {
    try {
      let result;
      if (action === "keep_waiting") {
        result = await resumePolling(page, sessionId);
      } else {
        result = await executePromptTurn(page, text, label, sessionId);
      }

      printResponseSummary(result.text);
      return { ok: true, text: result.text };
    } catch (err) {
      const recovery = await handleGeminiError(err, page);

      if (recovery?.action === "return") {
        return recovery.result;
      }

      action = recovery?.action || "retry_same";
    }
  }
}
