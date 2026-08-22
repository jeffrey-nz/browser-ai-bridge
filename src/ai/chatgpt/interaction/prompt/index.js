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
  // T-053/T-058/T-093 review: uploadFileToChatGpt is a direct pass-through
  // to uploadFile.js's own uploadFileToPage (no bespoke code of its own
  // that could throw first, unlike gemini/copilot) — `evidenceSelectorUsed`
  // is set before every throw EXCEPT uploadFileToPage's own fs.access
  // NOT_OFFERED check at its very top, which genuinely has no selector yet
  // to name. A false row needs this proof exactly as much as a true row
  // needs its match details, which is why imageAttachedEvidence below is
  // no longer gated behind `imageAttached`. The rest of evidenceOut's
  // fields (matchedAlternatives, requireGrowth/grew, elapsedMs, strategy)
  // are still populated only on a successful verify(). `false` still also
  // carries a cause via imageAttachedCause (T-038).
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
    // T-058: ungated to match src/ai/generic/interaction.js — a FALSE row
    // needs evidenceSelectorUsed exactly as much as a TRUE row needs its
    // match details. An evidenceOut with no keys (e.g. NOT_OFFERED, thrown
    // before uploadFile.js ever sets a field on it) is filtered out at the
    // consumer (src/routes/ask.js, src/routes/ask/askOne.js), not here.
    ...(imageAttached ? {} : { imageAttachedCause }),
    imageAttachedEvidence: evidenceOut,
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
