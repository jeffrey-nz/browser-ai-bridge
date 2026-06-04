import { injectGrokText, clickGrokSend, uploadFileToGrok } from "./input.js";
import { waitForGrokCompletion } from "./poll.js";
import { extractGrokResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { logger } from "#utils/logger.js";

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
  try {
    await uploadFileToGrok(page, filePath);
  } catch (err) {
    logger.warn(
      `[Grok] File upload failed: ${err.message} — sending text-only`,
    );
  }
  return sendPromptAndWait(page, text, label);
}
