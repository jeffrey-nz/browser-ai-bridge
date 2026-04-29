export const GEMINI_LOCATORS = {
  newChatBtn:
    '.side-nav-action-button, button:has-text("New chat"), a[href*="/app"]',
  inputBox: 'rich-textarea .ql-editor[contenteditable="true"]',
  sendBtn: '.send-button.submit, button[aria-label*="Send message"]',
  stopBtn: '.send-button.stop, button[aria-label*="Stop"]',
  responseBlock: "model-response, message-content",
  doneSignal:
    'message-actions, .response-actions-container, button[aria-label*="Good response"]',

  modeDropdown:
    "button.input-area-switch, button.bard-mode-menu-btn-for-nested-menu, .mode-picker-in-header",
  modes: {
    fast: '.gds-mode-switch-menu .bard-mode-list-button:has-text("Fast"), [role="menuitem"]:has-text("Fast")',
    thinking:
      '.gds-mode-switch-menu .bard-mode-list-button:has-text("Thinking"), [role="menuitem"]:has-text("Thinking")',
    pro: '.gds-mode-switch-menu .bard-mode-list-button:has-text("Pro"), [role="menuitem"]:has-text("Pro")',
  },
};
