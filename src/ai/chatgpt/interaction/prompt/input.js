import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import { uploadFileToPage } from "#ai/shared/uploadFile.js";

export async function injectChatGptText(page, text) {
  await clearAndType(
    page,
    page
      .locator(
        '#prompt-textarea, [data-testid="composer-input"], div[contenteditable="true"]',
      )
      .last(),
    text,
  );
}

export async function uploadFileToChatGpt(page, filePath) {
  // Claude.ai / ChatGPT: attachment button is a paperclip icon near the input.
  // Selector targets the attachment/file button in the composer toolbar.
  const chatgptAttachSelector =
    'button[aria-label*="Attach" i], button[aria-label*="attach file" i], ' +
    'button[data-testid*="attach" i], button[data-testid*="file" i], ' +
    '[class*="composer"] button:has(svg[class*="paperclip" i])';

  return uploadFileToPage(page, filePath, {
    attachmentBtnSelector: chatgptAttachSelector,
  });
}

export async function clickChatGptSend(page) {
  await clickOrFallbackToEnter(
    page,
    page
      .locator(
        '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send"]',
      )
      .first(),
    page.locator('#prompt-textarea, [data-testid="composer-input"]').last(),
    page.locator('[data-testid="stop-button"]').last(),
    { retries: 5, ctrlEnterFallback: true },
  );
}
