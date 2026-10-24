//[[ EVERY READ IS A LIST OF STRATEGIES, NEWEST FIRST, AND A MISS IS NAMED.
//
//   2026-10-25: ChatGPT moved to a new renderer. `[data-testid^="conversation-turn-"]`,
//   `article`, `[data-message-author-role]`, `.markdown`, `#prompt-textarea` and
//   `[data-testid="stop-button"]` all matched NOTHING, while the page answered
//   normally. The poller waited on the old turn selector, Playwright's innerText()
//   waited its own 30s default on every call for an element that would never exist,
//   and every ask ran to the 5-minute timeout with the answer on screen.
//
//   So each thing the bridge reads is an ordered list here: the current DOM first,
//   older shapes after it (a rollout can serve either), and `poll.js` names the
//   list that stopped matching — "provider DOM changed: assistant reply" — instead
//   of hanging. Measured on the live page that day:
//     turn       div[data-talvt-turn-state="in_progress" | "complete"]  (one per
//                user+assistant pair)
//     user       [data-user-message-bubble]
//     assistant  [data-markdown-text-style="assistant-message"], words streamed as
//                span[data-d-stream-word]
//     stop       button[aria-label="Stop"] in the composer
//     input      ProseMirror div[contenteditable][aria-label="Ask ChatGPT"]
//     copy       button[aria-label="Copy"] in the assistant half of the turn;
//                "Copy message" is now the USER bubble's copy button. ]]
export const CHATGPT_DOM = {
  turn: [
    "[data-talvt-turn-state]",
    '[data-testid^="conversation-turn-"]',
    "article",
  ],
  user: [
    "[data-user-message-bubble]",
    '[data-message-author-role="user"]',
  ],
  assistant: [
    '[data-markdown-text-style="assistant-message"]',
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
  ],
  stop: [
    'button[aria-label="Stop"]',
    '[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
  ],
  // The copy button of the ASSISTANT reply, searched inside its turn.
  copy: [
    'button[aria-label="Copy"]',
    '[data-testid="copy-turn-action-button"]',
  ],
};

export const CHATGPT_LOCATORS = {
  newChatBtn: '[data-testid="new-chat-button"], a[href="/"]',
  inputBox:
    '#prompt-textarea, [data-testid="composer-input"], form[data-chatgpt-composer] [contenteditable="true"], div.ProseMirror[contenteditable="true"], div[contenteditable="true"]',
  sendBtn:
    '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send"]',
  stopBtn: CHATGPT_DOM.stop.join(", "),
  conversationTurn: CHATGPT_DOM.turn.join(", "),
  responseBlock: CHATGPT_DOM.assistant.join(", "),
  errorAlert: '.alert-error, [role="alert"]:not(.sr-only)',
};
