import { logger } from "./logger.js";

//[[ SWALLOWING EVERY THROW ALSO SWALLOWED THE ANSWERS.
//
//   Ignoring what the predicate throws is right for the case it was written
//   for: a Playwright call against a page mid-navigation throws, the next tick
//   succeeds, and a poll that gave up on the first of those would be useless.
//   But `if (err.controlAbort) throw err` made that ONE flag the only way out,
//   and the providers do not use it. They set `err.rateLimited`, and they throw
//   `"Aborted (Web UI)"` — so both were caught here, logged at trace level, and
//   dropped, and the loop went on polling a page that was never going to answer.
//
//   MEASURED, 2026-09-24, grok.com: its poll detects the daily limit correctly
//   every 500ms and throws. The bridge log for that turn contains zero rate
//   limit lines and "Grok polling timed out (Timeout after 600000ms)" — TEN
//   MINUTES, four times over, one session per minute, seven alive at once
//   against a per-provider cap of three. The detection was never broken; its
//   result could not get out of this function.
//
//   Not a grok bug. `err.rateLimited` is thrown inside a predicate by grok,
//   chatgpt (three places) and src/ai/generic/interaction.js — which is kimi,
//   qwen, zai, mistral and perplexity — and `"Aborted (Web UI)"` by all of those
//   plus gemini, copilot and deepseek. Every one was discarded here.
//
//   So the contract is stated instead of implied: a predicate ends the poll by
//   throwing something explicitly marked terminal, and everything else is still
//   treated as an incidental fault and retried. The "Aborted" message is matched
//   because it is the established convention at all seven throw sites, and
//   copilot's sendSingleChunk.js already tests for it exactly this way. ]]
function isTerminal(err) {
  if (!err) return false;
  return (
    err.controlAbort === true ||
    err.rateLimited === true ||
    err.terminal === true ||
    err.name === "AbortError" ||
    /\bAborted\b/.test(err.message || "")
  );
}

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
      if (isTerminal(err)) throw err;
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
