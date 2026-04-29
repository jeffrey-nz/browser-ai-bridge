import { BaseProvider } from "#ai/shared/BaseProvider.js";
import {
  startNewChat,
  setResponseMode,
  sendPromptAndWait,
} from "./interaction.js";
import { isCopilotUrl, isCopilot365Url } from "./navigation.js";
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

export class Copilot365Provider extends BaseProvider {
  constructor() {
    super("Copilot 365", isCopilot365Url, "https://m365.cloud.microsoft/chat");
  }

  async startNewChat() {
    return await startNewChat(this.page);
  }

  async setMode(mode) {
    return await setResponseMode(this.page, mode, "copilot365");
  }

  async sendPromptAndWait(text, label, sessionId, pollTimeoutMs) {
    return await sendPromptAndWait(
      this.page,
      text,
      label,
      "copilot365",
      sessionId,
      pollTimeoutMs,
    );
  }

  async sendPromptOnly(text) {
    await injectAndSubmit(this.page, text);
  }
}
