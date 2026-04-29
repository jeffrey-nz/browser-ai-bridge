import { connectToChatGpt } from "./session.js";
import { initProvider } from "#ai/shared/providerInit.js";

export async function initChatGptProvider(options = {}) {
  return await initProvider("chatgpt", "ChatGPT", connectToChatGpt);
}
