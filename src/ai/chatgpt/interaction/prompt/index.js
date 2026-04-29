import { injectChatGptText, clickChatGptSend } from "./input.js";
import { waitForChatGptCompletion } from "./poll.js";
import { extractChatGptResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";

export async function sendPromptAndWait(page, text, label = "Prompt") {
  const prevMessage = page
    .locator('[data-testid^="conversation-turn-"]')
    .last();
  const prevText = await prevMessage.innerText().catch(() => "");

  return runPromptWorkflow(page, text, label, {
    providerName: "ChatGPT",
    injectText: injectChatGptText,
    clickSend: clickChatGptSend,
    waitForCompletion: async (pg, spinner) =>
      waitForChatGptCompletion(pg, prevText),
    extractResponse: extractChatGptResponse,
  });
}
