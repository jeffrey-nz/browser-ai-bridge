import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import {
  uploadFileToPage,
  waitForAttachmentEvidence,
} from "#ai/shared/uploadFile.js";
import { UPLOAD_CAUSES, UploadOutcomeError } from "#ai/shared/uploadOutcome.js";
import { logger } from "#utils/logger.js";
import fs from "node:fs/promises";

// Gemini renders an uploaded image as a thumbnail chip above the composer
// once ingestion finishes — this is the same evidence the settle-wait below
// is timed around, made explicit rather than trusted on faith.
const GEMINI_ATTACHMENT_EVIDENCE =
  'img[src^="blob:" i], [data-test-id*="file-preview" i], [class*="file-preview" i], ' +
  '[class*="uploaded-file" i], [class*="attachment-chip" i]';

export async function uploadFileToGemini(page, filePath) {
  // T-038: mirrors uploadFile.js's own file-existence throw — this is a
  // second, previously-unlisted site for the exact same NOT_OFFERED cause
  // (the shared uploadFileToPage() below is only reached when the menu
  // branch isn't visible, so this check can't be deleted in favour of its).
  try {
    await fs.access(filePath);
  } catch {
    throw new UploadOutcomeError(
      `Upload file not found: ${filePath}`,
      UPLOAD_CAUSES.NOT_OFFERED,
    );
  }

  // Gemini's composer button opens a sub-menu; the OS file chooser only
  // appears after clicking the "Files" / "Upload from computer" item inside
  // that menu, not the top-level button. The menu button was renamed to
  // "Upload & tools" (older builds: "Open upload file menu"). It is a
  // <gem-icon-button> custom element wrapping a plain <button>; the inner
  // button reports as pointer-intercepted, so we target the host element and
  // force the click. Generic uploadFileToPage Strategy 2 times out on the
  // filechooser because the first click only opens a sub-menu.
  const menuBtn = page
    .locator(
      'gem-icon-button[arialabel="Upload & tools"], ' +
        'gem-icon-button[aria-label="Upload & tools"], ' +
        'button[aria-label="Upload & tools"], [aria-label="Upload & tools"], ' +
        '[aria-label="Open upload file menu"], button[aria-label*="upload file menu" i]',
    )
    .first();
  // Poll for the upload-menu button rather than giving up after one short
  // check. After a fresh "new chat" the composer toolbar can take several
  // seconds to mount; if we fall through too early the generic fallback
  // (which has no Gemini-matching selector) fails and the prompt is silently
  // sent TEXT-ONLY — fatal for image transcription. Up to ~3×(4s+1.5s).
  let menuVisible = false;
  for (let attempt = 0; attempt < 3 && !menuVisible; attempt++) {
    menuVisible = await menuBtn.isVisible({ timeout: 4000 }).catch(() => false);
    if (!menuVisible) {
      logger.warn(
        `[Gemini] Upload menu button not ready (attempt ${attempt + 1}/3) — waiting…`,
      );
      await page.waitForTimeout(1500);
    }
  }

  if (menuVisible) {
    await menuBtn.click({ force: true });
    // The menu item is "Files" in current builds; older builds used
    // "Upload from computer".
    const uploadItem = page
      .locator(
        'button:has-text("Upload from computer"), ' +
          '[role="menuitem"]:has-text("Upload from computer"), ' +
          '[role="menuitem"]:has-text("computer"), ' +
          'button:text-is("Files"), [role="menuitem"]:text-is("Files"), ' +
          'button:has-text("Files")',
      )
      .first();
    await uploadItem.waitFor({ state: "visible", timeout: 5000 });
    // The menu panel animates in and can briefly sit partly off-screen, so
    // scroll the item into view before clicking.
    await uploadItem.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10000 }),
      uploadItem.click({ force: true }).catch(async () => {
        // Fallback: dispatch a DOM click if the normal click is blocked by
        // viewport/animation state. Playwright still catches the chooser.
        await uploadItem.dispatchEvent("click");
      }),
    ]);
    await fileChooser.setFiles(filePath);
    // Gemini ingests the file before the prompt can be sent; large files
    // (multi-MB audio renders) take noticeably longer than a small PNG.
    // Scale the settle wait by file size: ~1.5s base + 1s per MB, capped 30s.
    let settleMs = 1500;
    try {
      const { size } = await fs.stat(filePath);
      settleMs = Math.min(30000, 1500 + Math.round(size / 1024 / 1024) * 1000);
    } catch {}
    await page.waitForTimeout(settleMs);
    const attached = await waitForAttachmentEvidence(page, {
      selector: GEMINI_ATTACHMENT_EVIDENCE,
      timeoutMs: 6000,
    });
    if (attached) {
      logger.info(
        `[Gemini] Uploaded file via sub-menu file chooser (${filePath}) — attachment confirmed`,
      );
      return true;
    }
    // T-038: this branch used to `return false` here — a second,
    // previously-unlisted OFFERED-shaped site alongside uploadFile.js:193's
    // (the chooser DID accept the file; only the confirming evidence did
    // not appear). Throw the same UNCONFIRMED cause instead of returning a
    // bare false the wrapper's catch can never see.
    logger.warn(
      `[Gemini] Sub-menu file chooser accepted the file but no thumbnail/chip appeared for ${filePath}`,
    );
    throw new UploadOutcomeError(
      `Sub-menu file chooser accepted the file but no thumbnail/chip appeared for ${filePath}`,
      UPLOAD_CAUSES.UNCONFIRMED,
    );
  }

  return uploadFileToPage(page, filePath, {
    attachmentBtnSelector:
      'button[aria-label*="attach" i], button[aria-label*="image" i], [aria-label="Add image"], [aria-label="Add file"]',
    timeoutMs: 10000,
    verifySelector: GEMINI_ATTACHMENT_EVIDENCE,
  });
}

export async function injectGeminiText(page, text) {
  await clearAndType(
    page,
    page
      .locator('div.ql-editor[contenteditable="true"], rich-textarea > div')
      .first(),
    text,
    { useEvalClear: false, triggerEvents: true, chunkSize: 3000 },
  );
}

export async function clickGeminiSend(page) {
  const snackbar = page
    .locator("bard-simple-snack-bar, .mat-mdc-simple-snack-bar")
    .last();

  await clickOrFallbackToEnter(
    page,
    page
      .locator(
        'button[aria-label*="Send message"], .send-button-container button, button.send-button, [data-test-id="send-button"]',
      )
      .last(),
    page
      .locator('div.ql-editor[contenteditable="true"], rich-textarea > div')
      .first(),
    page
      .locator('button[aria-label*="Stop"], [data-testid="stop-button"]')
      .last(),
    {
      retries: 4,
      ctrlEnterFallback: true,
      shouldAbort: async () => {
        const visible = await snackbar
          .isVisible({ timeout: 200 })
          .catch(() => false);
        if (!visible) return null;
        const txt = await snackbar.innerText().catch(() => "");
        if (
          txt.includes("(13)") ||
          txt.toLowerCase().includes("something went wrong")
        ) {
          return new Error("GEMINI_SNACKBAR_ERROR_13");
        }
        return null;
      },
    },
  );
}
