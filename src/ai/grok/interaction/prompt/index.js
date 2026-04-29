import { injectGrokText, clickGrokSend } from "./input.js";
import { waitForGrokCompletion } from "./poll.js";
import { extractGrokResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";

export async function sendPromptAndWait(page, text, label = "Prompt") {
  return runPromptWorkflow(page, text, label, {
    providerName: "Grok",
    injectText: injectGrokText,
    clickSend: clickGrokSend,
    waitForCompletion: waitForGrokCompletion,
    extractResponse: extractGrokResponse,
  });
}
