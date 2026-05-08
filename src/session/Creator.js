import { randomUUID } from "node:crypto";
import { logger } from "#utils/logger.js";
import { sessionLogger } from "./Logger.js";

import { ChatGPTProvider } from "#ai/chatgpt/session.js";
import { GeminiProvider } from "#ai/gemini/session.js";
import { DeepSeekProvider } from "#ai/deepseek/session.js";
import { GrokProvider } from "#ai/grok/session.js";
import { CopilotProvider } from "#ai/copilot/client/session.js";

const PROVIDER_MAP = {
  chatgpt: ChatGPTProvider,
  gemini: GeminiProvider,
  deepseek: DeepSeekProvider,
  grok: GrokProvider,
  copilot: CopilotProvider,
};

export async function createNewSession(providerId) {
  const ProviderClass = PROVIDER_MAP[providerId];
  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  logger.info(`[Session] Starting advanced context for ${providerId}...`);

  const engineSession = new ProviderClass();
  await engineSession.initialize();

  const sessionId = randomUUID();
  const activeLogger = sessionLogger.initLog(sessionId, providerId);

  return {
    id: sessionId,
    providerId,
    engine: engineSession,
    page: engineSession.page,
    logPath: activeLogger,
    createdAt: new Date(),
  };
}
