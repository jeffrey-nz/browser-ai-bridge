import { connectToGemini } from "./session.js";
import { initProvider } from "#ai/shared/providerInit.js";

export async function initGeminiProvider(options = {}) {
  return await initProvider("gemini", "Gemini", connectToGemini);
}
