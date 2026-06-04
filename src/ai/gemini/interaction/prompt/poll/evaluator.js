// How many consecutive polls of byte-identical response text count as
// "settled". At ~0.5s/poll these are roughly seconds.
const STABLE_DONE = 4; //  settled + Stop button gone  → done quickly
const STABLE_FORCE_DONE = 20; //  settled this long      → done even if Stop lingers

export function evaluateCompletion(
  isGenerating,
  isDone,
  currentTextLength,
  state,
) {
  if (currentTextLength > 0 && currentTextLength === state.lastTextLength) {
    state.stableIterations++;
  } else {
    state.stableIterations = 0;
  }

  // Strongest cue: the response-actions / thumbs row rendered.
  if (isDone) return true;

  // Normal completion: text settled and the Stop button is gone.
  if (state.stableIterations >= STABLE_DONE && !isGenerating) return true;

  // Robustness: Gemini regularly leaves the "Stop" button in the DOM after a
  // turn is fully written (and the done-signal selector drifts), so neither
  // signal above ever fires. The poll then holds the caller until a stall
  // guard *discards* a finished answer 2-4 minutes later. Treat a response
  // whose text has been byte-for-byte stable for a long stretch as complete,
  // regardless of the Stop button — a written, unchanging answer is done.
  if (currentTextLength > 0 && state.stableIterations >= STABLE_FORCE_DONE) {
    return true;
  }

  return false;
}
