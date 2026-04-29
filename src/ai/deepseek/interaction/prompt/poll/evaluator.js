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

  if (!isGenerating) {
    stateContext.idleIterations = (stateContext.idleIterations || 0) + 1;

    if (stateContext.idleIterations > 25) {
      return true;
    }
  } else {
    stateContext.idleIterations = 0;
  }

  return false;
}
