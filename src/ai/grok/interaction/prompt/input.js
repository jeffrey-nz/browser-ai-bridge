import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import { uploadFileToPage } from "#ai/shared/uploadFile.js";

export async function uploadFileToGrok(page, filePath, evidenceOut = null) {
  // Grok's composer keeps a hidden <input type="file"> in most builds, which
  // the shared helper's Strategy 1 (direct setInputFiles) handles; the
  // selectors below are the Strategy-2 fallback (click → OS file chooser).
  const grokAttachSelector =
    'input[type="file"], ' +
    'button[aria-label*="attach" i], button[aria-label*="upload" i], ' +
    'button[aria-label*="add" i][aria-label*="file" i], ' +
    'button[aria-label*="image" i], button[data-testid*="attach" i], ' +
    'button[title*="attach" i]';
  return uploadFileToPage(page, filePath, {
    attachmentBtnSelector: grokAttachSelector,
    evidenceOut,
  });
}

export async function injectGrokText(page, text) {
  await clearAndType(
    page,
    page
      .locator(
        "div.tiptap.ProseMirror, div[contenteditable='true'][translate='no'], textarea",
      )
      .first(),
    text,
    { chunkSize: 4000, triggerEvents: true },
  );
}

export async function clickGrokSend(page) {
  const inputBox = page
    .locator(
      "div.tiptap.ProseMirror, div[contenteditable='true'][translate='no'], textarea",
    )
    .first();

  await clickOrFallbackToEnter(
    page,
    page
      .locator(
        "button[type='submit'][aria-label*='Submit' i], button[aria-label*='Submit' i], button[aria-label*='Grok']",
      )
      .last(),
    inputBox,
    page.locator("button[aria-label='Stop']").last(),
    { retries: 5, spaceHack: true, ctrlEnterFallback: true },
  );
}
