export const DEEPSEEK_LOCATORS = {
  newChatBtn:
    'div[tabindex="0"]:has(span:has-text("New chat")), div[tabindex="0"]:has-text("New chat"), [aria-label*="New chat" i], div[role="button"]:has-text("New chat"), .ds-sidebar-item:has-text("New chat")',
  inputBox:
    'textarea[placeholder*="Message DeepSeek" i], textarea[placeholder*="DeepSeek" i], textarea.ds-scroll-area, #chat-input',
  sendBtn:
    'div.ds-icon-button[role="button"]:has(svg path[d^="M8."]), div.ds-icon-button[role="button"]:has(svg path[d^="M9."]), div[role="button"][aria-label*="Send" i], .ds-send-button',
  stopBtn:
    'div.ds-icon-button[role="button"]:has(svg rect), div[role="button"][aria-label*="Stop" i], .ds-stop-button',
  responseBlock:
    ".ds-markdown, .markdown-body, .ds-message, .ds-chat-message, [class*='markdown'], [class*='message-content']",
  doneSignal: null,
  // DeepSeek renamed the reasoning toggle "DeepThink" → "Deep thinking"
  // (a div.ds-toggle-button). Match the current label, keeping the old one as
  // a fallback for older builds.
  modeToggle:
    '.ds-toggle-button:has-text("Deep thinking"), [class*="toggle-button"]:has-text("Deep thinking"), div[role="button"]:has-text("Deep thinking"), [aria-label*="DeepThink" i], .ds-toggle-button:has-text("DeepThink")',
  cloudflareOverlay: "#cf-overlay, .cf-browser-verification",
};
