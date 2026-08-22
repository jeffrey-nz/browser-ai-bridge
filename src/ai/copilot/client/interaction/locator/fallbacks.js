import { resolveVisibleInOrder } from "#ai/shared/locatorEngine.js";

export const FALLBACK_SELECTORS = {
  // T-108 review: merging inputLocator.js's old 9-selector list into this
  // one (clause 2) silently dropped 4 of the 9 — the four broadest
  // catch-alls, the ones that exist to still find the box on a build none
  // of the specific selectors above recognise: bare `textarea`,
  // `[contenteditable="true"]` (any element, not just a div — the entry
  // below is a strict subset), `[role="textbox"]`, and the case-
  // INSENSITIVE `textarea[aria-label*="Copilot" i]` (upgraded in place —
  // strictly more permissive than the case-sensitive version it replaces,
  // loses no match). Folded back in at the END, not the old positions —
  // now that list order actually binds (this is the whole point of this
  // ticket), the broadest, least-specific selectors belong last, tried
  // only once every more specific one has missed.
  input_box: [
    "#userInput",
    '[data-testid="composer-input"]',
    "#m365-chat-editor-target-element",
    '[data-lexical-editor="true"]',
    'textarea[aria-label*="Copilot" i]',
    'div[contenteditable="true"]',
    "#searchbox",
    ".copilot-input-box",
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]',
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
