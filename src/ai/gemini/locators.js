export const GEMINI_LOCATORS = {
  newChatBtn:
    '.side-nav-action-button, button:has-text("New chat"), a[href*="/app"]',
  inputBox: 'rich-textarea .ql-editor[contenteditable="true"]',
  sendBtn: '.send-button.submit, button[aria-label*="Send message"]',
  stopBtn: 'button[aria-label*="Stop"], .send-button.stop',
  responseBlock: "model-response, message-content",
  doneSignal:
    'message-actions, .response-actions-container, button[aria-label*="Good response"]',

  // Mode menu. Option test-ids are opaque hashes
  // (bard-mode-option-<hash>) and labels are version-numbered
  // ("3.5 Flash", "3.5 Thinking", "3.1 Pro"), so options are matched by a
  // stable keyword on their visible text. NB: "Fast" mode is labelled
  // "Flash" in the UI.
  modeDropdown:
    '[data-test-id="bard-mode-menu-button"], button.input-area-switch',
  modes: {
    fast: '[data-test-id^="bard-mode-option-"]:has-text("Flash")',
    thinking: '[data-test-id^="bard-mode-option-"]:has-text("Thinking")',
    pro: '[data-test-id^="bard-mode-option-"]:has-text("Pro")',
  },
};
