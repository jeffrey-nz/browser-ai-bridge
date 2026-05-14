import { logger } from "#utils/logger.js";
import { BaseProvider } from "#ai/shared/BaseProvider.js";
import {
  startNewChat,
  sendPromptAndWait,
  sendPromptWithFile,
  setMode,
} from "./interaction/index.js";
import {
  injectDeepSeekText,
  clickDeepSeekSend,
} from "./interaction/prompt/input.js";

export class DeepSeekProvider extends BaseProvider {
  constructor() {
    super(
      "DeepSeek",
      (url) => url.includes("deepseek.com"),
      "https://chat.deepseek.com/",
    );
  }

  async onTabSelected() {
    const currentUrl = this.page.url();
    if (currentUrl === "about:blank" || !currentUrl.includes("deepseek.com")) {
      logger.warn("ACTION REQUIRED: Browser stuck on blank page or challenge.");
      logger.warn(
        "Please manually navigate to chat.deepseek.com in the Chrome window.",
      );
    }
  }

  async startNewChat() {
    return await startNewChat(this.page);
  }

  async setMode(mode) {
    return await setMode(this.page, mode);
  }

  async sendPromptAndWait(text, label, sessionId) {
    return await sendPromptAndWait(this.page, text, label, sessionId);
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
    await injectDeepSeekText(this.page, text);
    await clickDeepSeekSend(this.page);
  }
}
