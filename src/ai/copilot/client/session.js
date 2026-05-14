import { BaseProvider } from "#ai/shared/BaseProvider.js";
import {
  startNewChat,
  setResponseMode,
  sendPromptAndWait,
} from "./interaction.js";
import { isCopilotUrl } from "./navigation.js";
import { injectAndSubmit } from "./interaction/prompt/send/submitter.js";

export class CopilotProvider extends BaseProvider {
  constructor() {
    super("Copilot", isCopilotUrl, "https://copilot.microsoft.com/");
  }

  async startNewChat() {
    return await startNewChat(this.page);
  }

  async setMode(mode) {
    return await setResponseMode(this.page, mode, "copilot");
  }

  async sendPromptAndWait(text, label, sessionId, pollTimeoutMs) {
    return await sendPromptAndWait(
      this.page,
      text,
      label,
      "copilot",
      sessionId,
      pollTimeoutMs,
    );
  }

  async sendPromptOnly(text) {
    await injectAndSubmit(this.page, text);
  }
}
