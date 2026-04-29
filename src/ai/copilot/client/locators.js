export const COPILOT_LOCATORS = {
  newChatBtn:
    '[data-testid="sidebar-new-conversation-nav-item"], button[aria-label="New chat"]',

  inputBox:
    '#userInput, [data-testid="composer-input"], textarea[placeholder*="Message Copilot"]',

  sendBtn:
    '[data-testid="submit-button"], button[aria-label="Submit message"], button[aria-label*="Send" i]',

  // During generation the composer send icon swaps to a stop icon.
  // The button keeps its testid; fallback on any "Stop" aria-label.
  stopBtn: '[data-testid="stop-button"], button[aria-label*="Stop" i]',

  // The new Copilot UI renders AI turns without fai-* or ac-* classes.
  // Match the first visible text container that holds a response.
  responseBlock:
    '[data-testid="ai-message"], [data-testid="chat-message-content"], [data-testid="message-content"], [data-testid="assistant-message"]',

  // After generation the action bar appears below the last AI turn.
  // Avoid broad "Copy" selectors — they match the user message's "Copy message"
  // button which fires before generation completes.
  doneSignal:
    '[data-testid="action-bar"], [data-testid="copy-button"], [data-testid="ai-message"], button[aria-label*="Like" i], button[aria-label*="Thumbs up" i]',
};

export const COPILOT_365_LOCATORS = {
  newChatBtn:
    '[data-automation-id="newChatButton"], [data-testid="newChatButton"], button[aria-label="New chat"]',
  inputBox: '#m365-chat-editor-target-element, [data-lexical-editor="true"]',
  sendBtn:
    'button[aria-label="Send"], button[data-testid*="send" i], [data-automation-id*="send" i], .fai-SendButton',
  stopBtn:
    'button[aria-label*="Stop" i], button[aria-label*="Interrupt" i], [data-testid="stop-button"], .fai-SendButton__stopIcon',
  responseBlock:
    '[data-testid="m365-chat-llm-web-ui-chat-message"], div[id^="chatMessageResponse-"], .fai-CopilotMessage__content',

  responseText: '[data-testid="markdown-reply"], [data-testid="chatOutput"]',
  doneSignal:
    '[data-testid="CopyButtonTestId"], [data-testid="CopyButtonContainerTestId"], button[aria-label="Copy Response"], [data-testid="FeedbackContainerTestId"]',

  navDrawer: ".fui-NavDrawer, .fai-CopilotNavDrawer",
  navCollapseBtn:
    'button[data-testid="collapse-button"], button[aria-label="Collapse navigation"]',

  pagesTriggerBtn: '[data-testid="pages-split-button-primary"]',
  pageWidget:
    '[data-testid="recall-card-test-id"], [data-testid="recall-card-response-message-test-id"], [data-testid="pages-sidepane"], .fai-RecallCard',
  pageCardInChat:
    '[data-testid="recall-card-test-id"], [data-testid="recall-card-response-message-test-id"], .fai-RecallCard',
  // Pages sidepane — data-testid may be absent; fall back to layout heuristics
  pageSidePane:
    '[data-testid="pages-sidepane"], [id*="pages-sidepane"], [aria-label*="Pages" i][role="complementary"]',
  closePageWidgetBtn:
    '[data-testid="discardButton"], [data-testid="pages-sidepane"] button[aria-label="Close"], button[aria-label="Close pane"], button[aria-label*="Discard" i], button[aria-label*="Close" i][data-testid*="close" i]',

  editInPageBtn:
    'button[aria-label*="Edit in Pages" i], button[aria-label*="Open in Pages" i], [data-testid="pages-edit-in-pages-button"], [data-testid*="pages-response-button" i]',

  // Microsoft Designer image generation embed
  designerImageFrame:
    '[id^="designer-host-"], iframe[src*="designer.svc.cloud.microsoft"], iframe[src*="chat-image-creator"], iframe[name="Microsoft Designer"]',
};
