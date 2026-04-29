export function getPollLocators(page) {
  return {
    stopBtn: page
      .locator(
        [
          'button[aria-label*="Stop" i]',
          'button[title*="Stop" i]',
          '[data-testid="stop-button"]',
          'button[aria-label*="Interrupt" i]',
          'button[title*="Interrupt" i]',
        ].join(", "),
      )
      .last(),

    doneSignal: page
      .locator(
        [
          '[data-testid="lastChatMessage"]',
          '[data-testid="CopyButtonTestId"]',
          '[data-testid="CopyButtonContainerTestId"]',
          ".ac-actionSet",
          'button[aria-label="Copy Response"]',
          'button[aria-label="Regenerate"]',
          '[data-testid="regenerate-message-button-popover"]',
          'button[aria-label*="Copy" i]',
          // Widget/Pages responses have no copy button — treat a recall card or
          // designer image appearing in the last message as a done signal too.
          '[data-testid="recall-card-test-id"]',
          '[data-testid="recall-card-response-message-test-id"]',
          '.fai-RecallCard',
          '[id^="designer-host-"]',
        ].join(", "),
      )
      .last(),

    refusalSignal: page
      .locator(
        "text=/try a different topic|can\\x27t respond|something went wrong|content policy|blocked/i",
      )
      .last(),
  };
}
