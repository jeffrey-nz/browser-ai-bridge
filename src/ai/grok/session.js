import { BaseProvider } from "#ai/shared/BaseProvider.js";
import {
  startNewChat,
  sendPromptAndWait,
  sendPromptWithFile,
  setMode,
} from "./interaction/index.js";
import { injectGrokText, clickGrokSend } from "./interaction/prompt/input.js";

export class GrokProvider extends BaseProvider {
  constructor() {
    super(
      "Grok",
      (url) => url.includes("x.com/i/grok") || url.includes("grok.com"),
      "https://grok.com/",
    );
  }

  async startNewChat() {
    return await startNewChat(this.page);
  }

  async setMode(mode) {
    return await setMode(this.page, mode);
  }

  async sendPromptAndWait(text, label) {
    return await sendPromptAndWait(this.page, text, label);
  }

  async sendPromptWithFile(text, label, sessionId, filePath) {
    return await sendPromptWithFile(
      this.page,
      filePath,
      text,
      label,
      sessionId,
    );
  }

  async sendPromptOnly(text) {
    await injectGrokText(this.page, text);
    await clickGrokSend(this.page);
  }
}
