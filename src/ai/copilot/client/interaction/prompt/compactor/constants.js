import process from "node:process";
import { PROVIDER_CONFIG } from "../../../../../../config/providers.js";

export function getCharLimit(providerName) {
  const configLimit = PROVIDER_CONFIG[providerName]?.maxPromptChars;
  if (configLimit) return configLimit;

  return Number(process.env.COPILOT_MAX_CHARS) || 32000;
}
