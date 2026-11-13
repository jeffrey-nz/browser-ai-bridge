//[[ ROLE/ARIA FIRST, THEN STRUCTURE (measured live on grok.com, 2026-11-14).
//
//   The send button used to be found as `button[aria-label*="Grok"]`, last
//   match. Grok then added a "Get Grok Bot with Premium" upsell button, which
//   is the last element whose label contains "Grok" — so the bridge clicked an
//   advert instead of Send. The real button is aria-label="Send"
//   (data-testid="chat-submit"); stop is aria-label="Stop"
//   (data-testid="composer-stop"). Never match a control by a brand word in its
//   label: every upsell carries the brand.
//
//   Turn layout: every message, user or assistant, is a div[id^="response-"];
//   inside it the bubble is role="article" with data-testid user-message /
//   assistant-message (both also carry .message-bubble — so `.message-bubble`
//   last-match can be the USER's prompt). The finished answer's toolbar
//   ("Copy response", "Good response", "Bad response") sits in the assistant's
//   response- div, outside the article. ]]

export const GROK_LOCATORS = {
  newChatBtn:
    'a[href="/"], a[aria-label*="new chat" i], .side-nav-action-button',
  // Editable only: a bare `.tiptap.ProseMirror` can also match a rendered
  // (read-only) message, and callers take `.first()` (see Mistral in
  // generic/specs.js, where that resent prompts).
  inputBox:
    'div[contenteditable="true"][role="textbox"], .tiptap.ProseMirror[contenteditable="true"], textarea[aria-label*="message" i]',
  sendBtn:
    'button[aria-label="Send"], button[data-testid="chat-submit"], button[type="submit"][aria-label*="Submit" i], button[aria-label="Submit"]',
  stopBtn:
    'button[aria-label="Stop"], button[data-testid="composer-stop"], button[aria-label*="stop generating" i]',
  // The assistant's bubble, newest last. Counted before a send.
  assistantMessage:
    '[data-testid="assistant-message"], div[id^="response-"]:has(.response-content-markdown)',
  // One message's container (user or assistant); holds the action toolbar.
  messageTurn: 'div[id^="response-"]',
  responseBlock:
    '[data-testid="assistant-message"] .response-content-markdown, [data-testid="assistant-message"], .response-content-markdown',
  doneSignal:
    'button[aria-label="Copy response"], button[aria-label="Good response"], button[aria-label="Like"], ' +
    '[role="toolbar"][aria-label="Response actions"]',
};
