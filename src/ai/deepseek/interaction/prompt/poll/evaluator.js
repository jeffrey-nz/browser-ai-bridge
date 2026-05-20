import { STABLE_ITERATIONS_REQUIRED } from "./constants.js";

export function evaluateDeepSeekCompletion(
  domState,
  stateContext,
  initialMsgCount,
) {
  const { isGenerating, currentCount, currentText } = domState;

  const hasNewElement = currentCount > initialMsgCount;
  const textGrewSignificantly =
    currentCount === initialMsgCount &&
    currentText.length > stateContext.lastTextLength + 20;

  const isNewMessage =
    (hasNewElement || textGrewSignificantly) && currentText.trim().length > 0;

  if (isNewMessage && !isGenerating) {
    if (
      currentText.length > 0 &&
      currentText.length === stateContext.lastTextLength
    ) {
      stateContext.stableIterations++;
    } else {
      stateContext.stableIterations = 0;
    }

    if (stateContext.stableIterations >= STABLE_ITERATIONS_REQUIRED) {
      return true;
    }

    stateContext.lastTextLength = currentText.length;
  } else if (isGenerating) {
    stateContext.stableIterations = 0;
    stateContext.lastTextLength = currentText.length;
  }

  // Idle-completion fallback: fires when generation appears stopped for ~12.5s.
  // It MUST also require the response text to have stopped growing — otherwise
  // a briefly-missed stop-button / streaming-network signal lets this fire
  // mid-stream and capture a truncated response (observed: plans/code cut off
  // near a fixed ~3900-char wall-clock position).
  if (!isGenerating) {
    const textStillGrowing =
      currentText.length > (stateContext.idleTextLength || 0);
    stateContext.idleTextLength = currentText.length;

    if (textStillGrowing) {
      stateContext.idleIterations = 0;
    } else {
      stateContext.idleIterations = (stateContext.idleIterations || 0) + 1;
      if (stateContext.idleIterations > 25) {
        return true;
      }
    }
  } else {
    stateContext.idleIterations = 0;
    stateContext.idleTextLength = currentText.length;
  }

  return false;
}
