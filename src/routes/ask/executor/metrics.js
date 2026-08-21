import { extractAndNormalize } from "#utils/responseParser.js";

// T-011: this used to also compute `messageCount` — a DOM count of chat
// bubbles, but only for copilot (session.providerId.includes("copilot")),
// hardcoded to 0 for the other nine providers, and consumed by nothing in
// this repo or in score-reader. It looked like it told a caller how far
// into a session an answer was taken; it did not — the 0/1 split was which
// PROVIDER answered, not which turn. Removed rather than fixed to compute
// honestly for all ten: nothing was reading it, and the real need (ordering
// answers within a session's life) is now met by turnIndex/sessionAgeMs on
// the response instead (executor/index.js, session.turnCount).
export async function gatherMetrics(session, responseText) {
  const { data: parsedData, normalizedText } =
    extractAndNormalize(responseText);

  return {
    data: parsedData,
    normalizedText,
  };
}
