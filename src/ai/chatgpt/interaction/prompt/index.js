import {
  injectChatGptText,
  clickChatGptSend,
  uploadFileToChatGpt,
} from "./input.js";
import { waitForChatGptCompletion } from "./poll.js";
import { extractChatGptResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { logger } from "#utils/logger.js";

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
) {
  logger.info(`[ChatGPT] Uploading file for visual analysis: ${filePath}`);
  try {
    await uploadFileToChatGpt(page, filePath);
  } catch (err) {
    logger.warn(
      `[ChatGPT] File upload failed: ${err.message} — sending text-only`,
    );
  }
  return sendPromptAndWait(page, text, label);
}

export async function sendPromptAndWait(
  page,
  text,
  label = "Prompt",
  sessionId = null,
) {
  const prevMessage = page
    .locator('[data-testid^="conversation-turn-"]')
    .last();
  const prevText = await prevMessage.innerText().catch(() => "");

  return runPromptWorkflow(page, text, label, {
    providerName: "ChatGPT",
    injectText: injectChatGptText,
    clickSend: clickChatGptSend,
    waitForCompletion: async (pg, spinner) =>
      waitForChatGptCompletion(pg, prevText, sessionId),
    extractResponse: extractChatGptResponse,
  });
}
