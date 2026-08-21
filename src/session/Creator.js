import { randomUUID } from "node:crypto";
import { logger } from "#utils/logger.js";
import { sessionLogger } from "./Logger.js";
import { recordFreshSessionCreated } from "./collapseDetector.js";

import { ChatGPTProvider } from "#ai/chatgpt/session.js";
import { GeminiProvider } from "#ai/gemini/session.js";
import { DeepSeekProvider } from "#ai/deepseek/session.js";
import { GrokProvider } from "#ai/grok/session.js";
import { CopilotProvider } from "#ai/copilot/client/session.js";
import { GENERIC_PROVIDERS } from "#ai/generic/session.js";

const PROVIDER_MAP = {
  ...GENERIC_PROVIDERS,
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

  // T-023: a freshly-initialized session proves the browser can still open
  // and drive a live page — the recovery signal for collapseDetector's
  // sticky lastUnexpectedPageCloseAt.
  recordFreshSessionCreated();

  const sessionId = randomUUID();
  const activeLogger = sessionLogger.initLog(sessionId, providerId);

  return {
    id: sessionId,
    providerId,
    engine: engineSession,
    page: engineSession.page,
    logPath: activeLogger,
    createdAt: new Date(),
    // T-011: how far into this session's life a given answer was taken —
    // incremented once per turn in runAskTurn (executor/index.js). Exposed
    // on the response as turnIndex/sessionAgeMs so a caller collecting a
    // corpus over time doesn't have to join it back from /api/ping's uptime
    // or session createdAt by wall clock, or worse, not have it at all.
    turnCount: 0,
  };
}
