import { BaseProvider } from "#ai/shared/BaseProvider.js";
import {
  startNewChat,
  sendPromptAndWait,
  setMode,
} from "./interaction/index.js";
import { injectGeminiText, clickGeminiSend } from "./interaction/prompt/input.js";

export class GeminiProvider extends BaseProvider {
  constructor() {
    super(
      "Gemini",
      (url) => url.includes("gemini.google.com"),
      "https://gemini.google.com/app",
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
    await injectGeminiText(this.page, text);
    await clickGeminiSend(this.page);
  }
}
