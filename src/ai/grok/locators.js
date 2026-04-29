export const GROK_LOCATORS = {
  newChatBtn: 'a[href="/"], .side-nav-action-button',
  inputBox: '.tiptap.ProseMirror, .tiptap[contenteditable="true"]',
  sendBtn:
    'button[aria-label*="Submit" i], button[type="submit"], button[aria-label*="Grok"]',
  stopBtn: 'button[aria-label="Stop"]',
  responseBlock:
    '.message-bubble, .response-content-markdown, div[id^="response-"]',
  doneSignal:
    'button[aria-label="Like"], button[aria-label="Copy"], button[aria-label*="share" i]',
};
