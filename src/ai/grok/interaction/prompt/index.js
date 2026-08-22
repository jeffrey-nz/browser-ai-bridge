import { injectGrokText, clickGrokSend, uploadFileToGrok } from "./input.js";
import { waitForGrokCompletion } from "./poll.js";
import { extractGrokResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { logger } from "#utils/logger.js";
import { classifyUploadError } from "#ai/shared/uploadOutcome.js";

export async function sendPromptAndWait(page, text, label = "Prompt") {
  return runPromptWorkflow(page, text, label, {
    providerName: "Grok",
    injectText: injectGrokText,
    clickSend: clickGrokSend,
    waitForCompletion: waitForGrokCompletion,
    extractResponse: extractGrokResponse,
  });
}

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
  sessionId = null,
) {
  logger.info(`[Grok] Uploading file for visual analysis: ${filePath}`);
  let imageAttached = false;
  let imageAttachedCause;
  // T-053/T-058/T-093 review: uploadFileToGrok is a direct pass-through to
  // uploadFile.js's own uploadFileToPage (no bespoke code of its own that
  // could throw first, unlike gemini/copilot) — so evidenceSelectorUsed is
  // set before every throw EXCEPT uploadFileToPage's own fs.access
  // NOT_OFFERED check at its very top, which genuinely has no selector yet
  // to name. imageAttachedEvidence below is not gated behind imageAttached
  // either way.
  const evidenceOut = {};
  try {
    imageAttached = await uploadFileToGrok(page, filePath, evidenceOut);
  } catch (err) {
    imageAttachedCause = classifyUploadError(err);
    logger.warn(
      `[Grok] File upload failed (${imageAttachedCause}): ${err.message} — sending text-only`,
    );
  }
  if (!imageAttached) {
    logger.warn(
      `[Grok] Upload could not be confirmed — sending text-only, caller should not trust a visual answer.`,
    );
  }
  const result = await sendPromptAndWait(page, text, label);
  return {
    ...result,
    imageAttached,
    // T-058: ungated — see src/ai/generic/interaction.js's own comment.
    // An empty evidenceOut is filtered at the consumer, not here.
    ...(imageAttached ? {} : { imageAttachedCause }),
    imageAttachedEvidence: evidenceOut,
  };
}
