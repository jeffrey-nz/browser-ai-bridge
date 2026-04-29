export const CHATGPT_LOCATORS = {
  newChatBtn: '[data-testid="new-chat-button"], a[href="/"]',
  inputBox:
    '#prompt-textarea, [data-testid="composer-input"], div[contenteditable="true"]',
  sendBtn:
    '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send"]',
  stopBtn: '[data-testid="stop-button"]',
  conversationTurn: '[data-testid^="conversation-turn-"]',
  responseBlock: ".markdown",
  errorAlert: '.alert-error, [role="alert"]:not(.sr-only)',
};
