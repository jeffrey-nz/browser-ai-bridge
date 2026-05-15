// --- FILE START ---
// Relative Path: src/ai/copilot/client/interaction/prompt/send/index.js

import { printResponseSummary } from "../summary.js";
import { getCharLimit, fitToCharLimit } from "../compactor/index.js";
import { chunkText } from "./chunker.js";
import { processChunks } from "./processChunks.js";
import { sendPromptAsFile } from "./sendAsFile.js";
import { waitForResponseAndExtract } from "./waitAndExtract.js";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

// Copilot's web UI rejects prompts longer than ~10,240 characters with a
// "Message exceeds 10240 characters." banner that disables submit. Anything
// over this gets uploaded as a .txt attachment instead.
const COPILOT_UI_HARD_LIMIT = 10000;

// Neutral format reminder — deliberately avoids naming M365 products (Pages, Canvas,
// Loop, Designer) because those exact product names in imperative "do not" phrasing
// reliably trigger Copilot's content filter, causing the chat-blocking refusal.
const WIDGET_GUARD =
  "[Format: Reply directly in this chat as plain text or a code block. Do not use external document editors or media tools.]\n\n";

export async function sendPromptAndWait(
  page,
  initialText,
  initialLabel = "Prompt",
  providerName = "copilot",
  sessionId = null,
  pollTimeoutMs = 420000,
) {
  // Apply widget guard — copilot.microsoft.com can respond with Pages/Designer widgets
  let text = fitToCharLimit(WIDGET_GUARD + initialText, providerName);
  let label = initialLabel;
  let correctionAttempts = 0;

  while (true) {
    // Over Copilot's UI hard limit — upload as a file attachment instead of
    // trying to inject 50k chars into a 10k textarea (which Copilot disables).
    if (text.length > COPILOT_UI_HARD_LIMIT) {
      const ok = await sendPromptAsFile(page, text);
      if (ok) {
        const result = await waitForResponseAndExtract(page, label, sessionId, pollTimeoutMs);
        if (result?.ok) {
          printResponseSummary(result.text);
          return result;
        }
        // Fall through to retry the legacy chunker path if the file flow
        // produced no usable response.
      }
      log(
        colors.yellow(
          "  [Copilot] File-upload path didn't yield a response — falling back to chunker.",
        ),
      );
    }

    const activeLimit = getCharLimit(providerName);
    const CHUNK_MAX = activeLimit - 500;

    const chunks =
      text.length > activeLimit ? chunkText(text, CHUNK_MAX) : [text];

    const finalValidation = await processChunks(
      page,
      chunks,
      label,
      sessionId,
      pollTimeoutMs,
    );

    if (finalValidation?.action === "retry") {
      continue;
    }

    if (finalValidation?.action === "return") {
      const res = finalValidation.result;

      // INTERCEPT WIDGET GENERATION AND ISSUE IN-CHAT CORRECTION
      if (res && res.needsCorrection && correctionAttempts < 2) {
        correctionAttempts++;
        log(
          `\n${colors.yellow("⚠️")} Triggering in-chat correction (${correctionAttempts}/2) to bypass widget creation...`,
        );

        // Send a short, neutral correction that does NOT repeat the M365 product
        // names (Pages/Canvas/Loop/Designer). Repeating those phrases in a "do not"
        // instruction reliably triggers the same content-filter block we are trying
        // to recover from.
        text =
          "Please write your answer as plain text or a JSON code block directly in this chat response, not as an external document.";
        label = `Correction Prompt (${correctionAttempts})`;
        continue;
      }

      return res;
    }

    if (finalValidation?.action === "success") {
      printResponseSummary(finalValidation.text);
      return { ok: true, text: finalValidation.text };
    }

    if (
      !finalValidation ||
      !["retry", "return", "success"].includes(finalValidation.action)
    ) {
      return { ok: false, reason: "Chunk processing failed without recovery." };
    }
  }
}
