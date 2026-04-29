import { printResponseSummary } from "#copilot/client/interaction/prompt/summary.js";
import { executePromptTurn, resumePolling } from "./executeTurn.js";
import { handleGeminiError } from "./errorHandler.js";

export async function sendPromptAndWait(
  page,
  initialText,
  initialLabel = "Prompt",
) {
  let text = initialText;
  let label = initialLabel;
  let action = "retry_same";

  while (true) {
    try {
      let result;
      if (action === "keep_waiting") {
        result = await resumePolling(page);
      } else {
        result = await executePromptTurn(page, text, label);
      }

      printResponseSummary(result.text);
      return { ok: true, text: result.text };
    } catch (err) {
      const recovery = await handleGeminiError(err, page);

      if (recovery?.action === "return") {
        return recovery.result;
      }

      action = recovery?.action || "retry_same";
    }
  }
}
