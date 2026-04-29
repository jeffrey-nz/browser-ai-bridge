import { logger } from "./logger.js";

export async function pollUntil(conditionFn, options = {}) {
  const {
    timeoutMs = 30000,
    pollIntervalMs = 500,
    errorMessage = "Polling timed out",
  } = options;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const result = await conditionFn();
      if (result) return result;
    } catch (err) {
      if (err.controlAbort) throw err;
      logger.trace(`[Poller] Condition check threw, ignoring: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`${errorMessage} (Timeout after ${timeoutMs}ms)`);
}
