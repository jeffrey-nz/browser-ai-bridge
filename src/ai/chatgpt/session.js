import { BaseProvider } from "#ai/shared/BaseProvider.js";
import {
  startNewChat,
  sendPromptAndWait,
  setMode,
} from "./interaction/index.js";
import { injectChatGptText, clickChatGptSend } from "./interaction/prompt/input.js";

export class ChatGPTProvider extends BaseProvider {
  constructor() {
    super(
      "ChatGPT",
      (url) => url.includes("chatgpt.com"),
      "https://chatgpt.com/",
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

  async sendPromptOnly(text) {
    await injectChatGptText(this.page, text);
    await clickChatGptSend(this.page);
  }
}
