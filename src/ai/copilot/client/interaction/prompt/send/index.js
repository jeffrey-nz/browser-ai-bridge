// --- FILE START ---
// Relative Path: src/ai/copilot/client/interaction/prompt/send/index.js

import { printResponseSummary } from "../summary.js";
import { getCharLimit, fitToCharLimit } from "../compactor/index.js";
import { chunkText } from "./chunker.js";
import { processChunks } from "./processChunks.js";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

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
  const is365 = providerName === "copilot365";
  // Apply the widget guard to both Copilot variants — regular copilot.microsoft.com
  // can also respond with Pages/Designer widgets instead of chat text.
  let text = fitToCharLimit(WIDGET_GUARD + initialText, providerName);
  let label = initialLabel;
  let correctionAttempts = 0;

  while (true) {
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
        log(`\n${colors.yellow("⚠️")} Triggering in-chat correction (${correctionAttempts}/2) to bypass widget creation...`);

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