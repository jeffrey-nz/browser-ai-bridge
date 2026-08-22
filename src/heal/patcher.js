import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "#utils/logger.js";

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PROVIDER_LOCATOR_PATHS = {
  deepseek: "ai/deepseek/locators.js",
  chatgpt: "ai/chatgpt/locators.js",
  gemini: "ai/gemini/locators.js",
  grok: "ai/grok/locators.js",
  copilot: "ai/copilot/client/locators.js",
};

export function resolveLocatorsPath(providerId) {
  const rel = PROVIDER_LOCATOR_PATHS[providerId];
  return rel ? path.join(SRC_ROOT, rel) : null;
}

export function extractCodeBlock(gptResponse) {
  const match = gptResponse.match(/```(?:javascript|js)\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

export function parseLocatorValues(codeBlock) {
  const result = {};
  const propRe = /(\w+)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  let m;
  while ((m = propRe.exec(codeBlock)) !== null) {
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : m[3];
    result[key] = val;
  }
  return result;
}

export function patchLocatorsFile(providerId, codeBlock) {
  const fullPath = resolveLocatorsPath(providerId);
  if (!fullPath) {
    logger.warn(
      `[SelfHeal] No locators path mapped for providerId="${providerId}"`,
    );
    return null;
  }

  if (!fs.existsSync(fullPath)) {
    logger.warn(`[SelfHeal] Locators file not found: ${fullPath}`);
    return null;
  }

  const backup = fullPath + ".bak";
  try {
    fs.copyFileSync(fullPath, backup);
  } catch {}

  fs.writeFileSync(fullPath, codeBlock + "\n", "utf8");
  logger.info(
    `[SelfHeal] Patched locators file: ${PROVIDER_LOCATOR_PATHS[providerId]}`,
  );
  return fullPath;
}
