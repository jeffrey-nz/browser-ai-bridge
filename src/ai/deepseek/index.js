import { connectToDeepSeek } from "./session.js";
import { initProvider } from "#ai/shared/providerInit.js";

export async function initDeepSeekProvider(options = {}) {
  return await initProvider("deepseek", "DeepSeek", connectToDeepSeek);
}
