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
  //
  // T-045: it ALSO must not fire before generation has ever been observed to
  // start. DeepSeek can hold a submitted turn for 25-30s before its own
  // /chat/completion request is even issued (a client-side proof-of-work
  // challenge, confirmed via a live network trace) — isGenerating is false
  // and currentText is "" that entire time because no .ds-markdown block
  // exists yet, which used to satisfy this fallback's own "idle" definition
  // (12.5s of an unchanging, empty string) and declare the turn complete
  // before it had even been sent. Extraction then fell back to a broad
  // selector and grabbed unrelated page content (the composer/user message)
  // as if it were the reply. Gating on everGenerating leaves the fallback's
  // original job intact — real generation still sets it on its first
  // observed tick — while refusing to call "stopped" a turn that never
  // started.
  if (!isGenerating) {
    const textStillGrowing =
      currentText.length > (stateContext.idleTextLength || 0);
    stateContext.idleTextLength = currentText.length;

    if (textStillGrowing) {
      stateContext.idleIterations = 0;
    } else if (stateContext.everGenerating) {
      stateContext.idleIterations = (stateContext.idleIterations || 0) + 1;
      if (stateContext.idleIterations > 25) {
        return true;
      }
    }
  } else {
    stateContext.everGenerating = true;
    stateContext.idleIterations = 0;
    stateContext.idleTextLength = currentText.length;
  }

  return false;
}
