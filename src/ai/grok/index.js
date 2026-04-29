import { connectToGrok } from "./session.js";
import { initProvider } from "#ai/shared/providerInit.js";

export async function initGrokProvider(options = {}) {
  return await initProvider("grok", "Grok", connectToGrok);
}
