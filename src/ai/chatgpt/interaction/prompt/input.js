import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import {
  uploadFileToPage,
  DEFAULT_ATTACHMENT_EVIDENCE,
} from "#ai/shared/uploadFile.js";

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

export async function uploadFileToChatGpt(page, filePath, evidenceOut = null) {
  // Claude.ai / ChatGPT: attachment button is a paperclip icon near the input.
  // Selector targets the attachment/file button in the composer toolbar.
  const chatgptAttachSelector =
    'button[aria-label*="Attach" i], button[aria-label*="attach file" i], ' +
    'button[data-testid*="attach" i], button[data-testid*="file" i], ' +
    '[class*="composer"] button:has(svg[class*="paperclip" i])';

  // T-042: DEFAULT_ATTACHMENT_EVIDENCE never matches chatgpt's real
  // thumbnail — confirmed by direct DOM inspection (9/9 attachment-diagnose
  // repro, plus a manual network-request trace showing the upload itself
  // succeeding end-to-end — POST .../backend-api/files, a PUT to blob
  // storage, process_upload_stream — every time, with a real thumbnail
  // visibly rendered every time). chatgpt's thumbnail is an
  // `aria-label="Open image: User uploaded image"` button wrapping an
  // `<img src="https://chatgpt.com/backend-api/estuary/content?...">` —
  // never a `blob:` src, no "attachment"/"thumbnail"/"file-preview" class or
  // testid anywhere on it, so every alternative in DEFAULT_ATTACHMENT_EVIDENCE
  // misses it. Keep the shared defaults too (harmless if they never match,
  // and free coverage if a future redesign happens to satisfy one of them).
  const chatgptEvidenceSelector =
    DEFAULT_ATTACHMENT_EVIDENCE +
    ', button[aria-label*="uploaded image" i], img[src*="backend-api/estuary" i], img[src*="backend-api/files" i]';

  return uploadFileToPage(page, filePath, {
    attachmentBtnSelector: chatgptAttachSelector,
    verifySelector: chatgptEvidenceSelector,
    // T-047: T-042's evidence (the img/button pair above) matches a durable
    // https://.../backend-api/... URL, not a composer-scoped blob: one — it
    // does not die with its draft, and stays visible above the composer
    // once a turn is sent. requireGrowth:false (uploadFileToPage's default)
    // makes verify() pure presence: the first visible match anywhere on the
    // page. On a second image turn in the same conversation (a session this
    // bridge's own reuse model makes ordinary — nothing calls startNewChat
    // between normal turns), a PRIOR turn's own thumbnail would satisfy
    // THIS turn's evidence check instantly, whether or not this turn's own
    // upload did anything at all. Same shape T-031 found on kimi, same fix
    // T-034 shipped for it: require the count to grow past whatever was
    // already on the page when THIS call started, not merely be present.
    requireGrowth: true,
    evidenceOut,
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
    {
      retries: 5,
      ctrlEnterFallback: true,
      verifyWaitMs: 5000,
      postClickWaitMs: 3000,
    },
  );
}
