import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import { uploadFileToPage } from "#ai/shared/uploadFile.js";
import { GROK_LOCATORS as L } from "#ai/grok/locators.js";

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
  await clearAndType(page, page.locator(L.inputBox).first(), text, {
    chunkSize: 4000,
    triggerEvents: true,
  });
}

export async function clickGrokSend(page) {
  const inputBox = page.locator(L.inputBox).first();

  await clickOrFallbackToEnter(
    page,
    // .first(): the composer's own Send. Never `aria-label*="Grok"` — see
    // locators.js, that matched the "Get Grok Bot with Premium" upsell.
    page.locator(L.sendBtn).first(),
    inputBox,
    page.locator(L.stopBtn).last(),
    { retries: 5, spaceHack: true, ctrlEnterFallback: true },
  );
}
