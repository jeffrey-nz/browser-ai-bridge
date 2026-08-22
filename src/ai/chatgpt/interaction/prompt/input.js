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
  // DEAD END — DO NOT "FIX" THIS SELECTOR. T-103 (commit 334652f) measured,
  // with a live CDP event trace plus a window.showOpenFilePicker() shim, that
  // chatgpt's real attach control ([data-testid="composer-plus-btn"] → the
  // menu item "Add photos & files") calls showOpenFilePicker() and raises
  // ZERO Page.* events — fileChooserOpened included. Playwright's
  // waitForEvent("filechooser") is backed by CDP's legacy
  // Page.fileChooserOpened, which the File System Access API never triggers.
  // So Strategy 2 below (uploadFileToPage's attachmentBtnSelector →
  // waitForEvent("filechooser") path) is structurally unreachable for
  // chatgpt — no selector, however accurate, can make it fire a chooser.
  // The string below is left stale (a five-line paperclip guess this ticket's
  // own history, T-018, shows predates the current UI) on purpose: replacing
  // it with the now-confirmed real selector would not make Strategy 2 work,
  // and would read as a fix that isn't one. T-018 measured that Strategy 1
  // below (the hidden input[type="file"]) IS the only path that can ever
  // succeed for chatgpt — real, but racy (T-042, T-018's own live 2/3 sample).
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
  // `<img src="https://chatgpt.com/backend-api/estuary/content?...">`.
  //
  // T-130 CORRECTION — "never a `blob:` src" above is WRONG, and "harmless
  // if they never match" is backwards. Measured across the whole tracked
  // corpus (reports/vision-probe/), not one row: of 8 chatgpt rows with
  // imageAttached:true (excluding blind turns), `img[src^="blob:" i]`
  // matched WITHOUT the estuary/backend-api img on 7 of them. 6 of those 7
  // are CONFIRMED (the model stated the correct COUNT — genuinely correct
  // by this board's strongest check); the 7th is the one row where the
  // model answered SEES=no despite imageAttached:true.
  //
  // So the blob:-only signature is NOT diagnostic of failure — it is the
  // NORMAL evidence footprint for chatgpt's imageAttached:true, present on
  // both real successes and the one denied row alike. That means it also
  // is NOT proof of success: `imageAttached:true` on a chatgpt row says
  // "some evidence alternative matched", not "the image reached the
  // model" — those are different claims, and this evidence set cannot
  // currently tell them apart. Do NOT "fix" this by requiring the
  // estuary/backend-api alternative instead: T-130 tried to observe the
  // ordering live (does the estuary img ever appear, and when, relative to
  // the blob: preview and the network response) and could not — 8
  // consecutive live attempts that session produced zero network requests
  // to backend-api/files and zero evidence growth at all, a state qual-
  // itatively different from the corpus rows above and not explained.
  // Tightening verify() to require server confirmation would flip 6 of the
  // 7 currently-CONFIRMED rows above to reading as failures — a measured
  // regression on rows independently proven correct, not an improvement.
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
