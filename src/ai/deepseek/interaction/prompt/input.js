import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import { resolveSelector } from "#ai/shared/locatorEngine.js";
import { DEEPSEEK_LOCATORS } from "../../locators.js";
import { uploadFileToPage } from "#ai/shared/uploadFile.js";

export async function injectDeepSeekText(page, text) {
  const inputSel = await resolveSelector(page, DEEPSEEK_LOCATORS.inputBox);
  await clearAndType(page, page.locator(inputSel).last(), text, {
    useEvalClear: true,
    triggerEvents: true,
  });
}

export async function uploadFileToDeepSeek(page, filePath) {
  // DeepSeek chat has an image/file upload button near the input toolbar.
  // The button is typically a small icon that triggers a file chooser.
  // Known selectors for DeepSeek's attachment button (checked against chat.deepseek.com):
  const deepseekAttachSelector =
    '[class*="chat-input"] [class*="upload" i], ' +
    '[class*="ds-toolbar"] button:first-child, ' +
    'button[aria-label*="upload" i], button[aria-label*="image" i], ' +
    '.ds-icon-button:has(svg[class*="image" i]), .ds-icon-button:has(svg[class*="file" i])';

  return uploadFileToPage(page, filePath, {
    attachmentBtnSelector: deepseekAttachSelector,
  });
}

export async function clickDeepSeekSend(page) {
  const sendSel = await resolveSelector(page, DEEPSEEK_LOCATORS.sendBtn);
  const inputSel = await resolveSelector(page, DEEPSEEK_LOCATORS.inputBox);
  const stopSel = await resolveSelector(page, DEEPSEEK_LOCATORS.stopBtn);

  await clickOrFallbackToEnter(
    page,
    page.locator(sendSel).last(),
    page.locator(inputSel).last(),
    page.locator(stopSel).last(),
    { retries: 5, ctrlEnterFallback: true },
  );
}
