export function evaluateCompletion(domState, previousText, previousCount) {
  const { isGenerating, isDone, isRefused, currentCount, currentText } =
    domState;

  if (isGenerating) return false;

  const text = currentText.trim();
  const prev = (previousText || "").trim();
  const textHasChanged = text !== "" && text !== prev;

  if (isDone || isRefused) {
    if (textHasChanged) return true;
    // Widget/Pages responses have no copy button — the done signal fires via the
    // recall card or designer iframe selector instead. These responses often have
    // very short text ("Here's your new page") but no actual textHasChanged
    // because the AI text is empty. Treat isDone-with-no-text as complete so
    // the widget detection path in waiter.js can handle correction.
    if (!isGenerating && text === "" && isDone) return true;
  }

  if (currentCount > previousCount && !isGenerating && textHasChanged) {
    return true;
  }

  if (
    text.toUpperCase().includes("ACK PART") ||
    text.toUpperCase().includes("READY")
  ) {
    if (!isGenerating) return true;
  }

  return false;
}
