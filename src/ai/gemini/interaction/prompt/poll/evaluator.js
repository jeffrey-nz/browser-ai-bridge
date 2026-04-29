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

  if (isDone || (state.stableIterations >= 4 && !isGenerating)) {
    return true;
  }

  return false;
}
