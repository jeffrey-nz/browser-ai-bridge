import {
  injectChatGptText,
  clickChatGptSend,
  uploadFileToChatGpt,
} from "./input.js";
import { waitForChatGptCompletion } from "./poll.js";
import { extractChatGptResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { logger } from "#utils/logger.js";
import { classifyUploadError } from "#ai/shared/uploadOutcome.js";

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
) {
  logger.info(`[ChatGPT] Uploading file for visual analysis: ${filePath}`);
  let imageAttached = false;
  let imageAttachedCause;
  // T-053: populated by uploadFileToChatGpt only on a successful verify() —
  // see uploadFile.js's own evidenceOut comment for why (matchedAlternatives,
  // requireGrowth/grew, elapsedMs, strategy). `false` still carries a cause
  // via imageAttachedCause (T-038); this is the same thing for `true`.
  const evidenceOut = {};
  try {
    imageAttached = await uploadFileToChatGpt(page, filePath, evidenceOut);
  } catch (err) {
    imageAttachedCause = classifyUploadError(err);
    logger.warn(
      `[ChatGPT] File upload failed (${imageAttachedCause}): ${err.message} — sending text-only`,
    );
  }
  if (!imageAttached) {
    logger.warn(
      `[ChatGPT] Upload could not be confirmed — sending text-only, caller should not trust a visual answer.`,
    );
  }
  const result = await sendPromptAndWait(page, text, label);
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
