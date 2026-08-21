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
  try {
    imageAttached = await uploadFileToGrok(page, filePath);
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
    ...(imageAttached ? {} : { imageAttachedCause }),
  };
}
