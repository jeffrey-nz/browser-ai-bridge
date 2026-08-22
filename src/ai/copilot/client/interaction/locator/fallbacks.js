import { resolveVisibleInOrder } from "#ai/shared/locatorEngine.js";

export const FALLBACK_SELECTORS = {
  input_box: [
    "#userInput",
    '[data-testid="composer-input"]',
    "#m365-chat-editor-target-element",
    '[data-lexical-editor="true"]',
    'textarea[aria-label*="Copilot"]',
    'div[contenteditable="true"]',
    "#searchbox",
    ".copilot-input-box",
  ],
  submit_btn: [
    'button[aria-label="Submit"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button[title="Submit"]',
    'button[title="Send"]',
    "button.send-button",
    '[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    '[data-testid*="send" i]',
    '[data-testid*="submit" i]',
    '[data-automation-id*="send" i]',
    '[data-automation-id*="submit" i]',

    '[data-testid="composer-content"] button:not([id="composer-create-button"]):not([data-testid="composer-chat-mode-smart-button"]):not([data-testid="audio-call-button"])',
  ],
  new_chat_btn: [
    '[data-testid="newChatButton"]',
    '[data-automation-id="newChatButton"]',
    '[data-testid="sidebar-new-conversation-nav-item"]',
    'button[aria-label*="New"]',
    ".new-topic-button",
    'button:has-text("New chat")',
    'a[href="/"]',
  ],
};

export async function tryFallbacks(page, key) {
  const fallbacks = FALLBACK_SELECTORS[key];
  if (!fallbacks) return null;

  return resolveVisibleInOrder(page, "copilot", key, fallbacks);
}
