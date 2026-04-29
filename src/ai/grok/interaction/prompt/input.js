import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";

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
