import { logger } from "./logger.js";

export async function pollUntil(conditionFn, options = {}) {
  const {
    timeoutMs = 30000,
    pollIntervalMs = 500,
    errorMessage = "Polling timed out",
    // Per-iteration cap: if conditionFn() never resolves (e.g. Playwright hangs
    // on a disconnected page), the deadline check is never re-evaluated. Cap each
    // call so the loop can still advance and eventually hit the deadline.
    iterationTimeoutMs = 8000,
  } = options;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const iterTimeout = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("iteration_timeout")),
          iterationTimeoutMs,
        ),
      );
      const result = await Promise.race([conditionFn(), iterTimeout]);
      if (result) return result;
    } catch (err) {
      if (err.controlAbort) throw err;
      if (err.message === "iteration_timeout") {
        logger.trace(
          `[Poller] Condition check timed out (>${iterationTimeoutMs}ms), retrying`,
        );
      } else {
        logger.trace(
          `[Poller] Condition check threw, ignoring: ${err.message}`,
        );
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`${errorMessage} (Timeout after ${timeoutMs}ms)`);
}
