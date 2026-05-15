/**
 * After we've submitted a prompt-as-file, wait for the response to complete
 * and pull it out. Separate from the chunker path because we don't need the
 * inter-chunk ack dance — there's only one message.
 */

import { waitForCompletion } from "../poll/index.js";
import { extractLastMessage } from "../extract/index.js";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function waitForResponseAndExtract(page, label, sessionId, pollTimeoutMs) {
  try {
    log(colors.dim(`  [Copilot] Waiting for response to '${label}'...`));
    // waitForCompletion signature: (page, submitResult, spinner, sessionId, pollTimeoutMs)
    const completed = await waitForCompletion(page, {}, null, sessionId, pollTimeoutMs);
    if (!completed) {
      return { ok: false, reason: "Generation did not complete within timeout." };
    }
    const text = await extractLastMessage(page);
    if (!text || !text.trim()) {
      return { ok: false, reason: "Response was empty after generation completed." };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: `Extraction failed: ${err.message || err}` };
  }
}
