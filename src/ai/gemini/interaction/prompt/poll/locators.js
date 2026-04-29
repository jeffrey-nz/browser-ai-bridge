export function getPollLocators(page) {
  return {
    stopBtn: page
      .locator('button[aria-label*="Stop"], [data-testid="stop-button"]')
      .last(),
    snackbar: page
      .locator("bard-simple-snack-bar, .mat-mdc-simple-snack-bar")
      .last(),
    lastResponse: page.locator("model-response, response-container").last(),
  };
}

export function getDoneSignal(lastResponse) {
  return lastResponse
    .locator(
      'message-actions, .response-actions-container, [aria-label*="Good response"]',
    )
    .first();
}
