/**
 * Send a prompt to Copilot ABOUT an attached image (an image-ask), so the
 * bridge can fall back to Copilot for sheet-music vision when Gemini is down.
 *
 * Unlike sendAsFile.js (which uploads a long *text* prompt as a .txt), this
 * uploads the caller's image and asks the prompt against it — one message,
 * then wait + extract.
 */
import { attachFileToCopilot } from "./sendAsFile.js";
import { injectAndSubmit } from "./submitter.js";
import { waitForResponseAndExtract } from "./waitAndExtract.js";
import { printResponseSummary } from "../summary.js";
import { logger } from "#utils/logger.js";
import { classifyUploadError } from "#ai/shared/uploadOutcome.js";

// Keep Copilot answering inline (it otherwise loves to spin up Pages/Designer
// widgets); deliberately avoids naming M365 products, which trip its filter.
const IMG_GUARD =
  "[Format: Reply directly in this chat as plain text or a code block. " +
  "Do not use external document editors or media tools.]\n\n";

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
  sessionId = null,
  pollTimeoutMs = 420000,
) {
  logger.info(`[Copilot] Uploading image for visual analysis: ${filePath}`);
  let imageAttached = false;
  let imageAttachedCause;
  // T-093: attachFileToCopilot has NO shared verifySelector — unlike the
  // four providers that go through uploadFile.js, it never sets
  // evidenceSelectorUsed (see its own comment at sendAsFile.js's throw
  // site). What it DOES record before its own UNCONFIRMED throw:
  // strategiesAttempted and confirmed:false. imageAttachedEvidence below
  // is not gated behind imageAttached either way.
  const evidenceOut = {};
  try {
    imageAttached = await attachFileToCopilot(page, filePath, evidenceOut);
  } catch (err) {
    imageAttachedCause = classifyUploadError(err);
    logger.warn(
      `[Copilot] Image upload failed (${imageAttachedCause}): ${err.message} — sending text-only`,
    );
  }

  await injectAndSubmit(page, IMG_GUARD + text);
  const result = await waitForResponseAndExtract(
    page,
    label,
    sessionId,
    pollTimeoutMs,
  );
  if (result?.ok) printResponseSummary(result.text);
  return {
    ...result,
    imageAttached,
    // T-058: ungated — see src/ai/generic/interaction.js's own comment.
    // An empty evidenceOut is filtered at the consumer, not here.
    ...(imageAttached ? {} : { imageAttachedCause }),
    imageAttachedEvidence: evidenceOut,
  };
}
