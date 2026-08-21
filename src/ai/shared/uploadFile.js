/**
 * uploadFile.js — uploads a local file to the currently-open AI chat page.
 *
 * Tries two strategies in order:
 *   1. Direct setInputFiles on any hidden input[type="file"] on the page.
 *   2. Click an attachment/upload button to trigger a file chooser dialog,
 *      then intercept it with Playwright's waitForEvent("filechooser").
 *
 * Returns true on success, throws on failure.
 * Always call this BEFORE injectText so the attachment is ready when text is sent.
 *
 * NEITHER STRATEGY, ON ITS OWN, PROVES THE UPLOAD LANDED. `setInputFiles`
 * resolves as soon as the DOM element's `.files` list is set — even when
 * that element is an unrelated hidden input the page never wired to its
 * composer. That gap is exactly how /api/ask reported success:true for
 * seven of eight providers that never actually received an image (see
 * T-001 on the crew board). So after either strategy we wait for visible
 * evidence in the page — a blob-URL thumbnail, an attachment chip — and
 * only report success if that evidence actually appears.
 */

import { logger } from "#utils/logger.js";
import fs from "node:fs/promises";

/**
 * Default evidence that a file was actually attached to the composer, not
 * just handed to some decoy input. Covers the two shapes seen across these
 * sites: an image preview rendered from a blob: object URL (most chat UIs,
 * for image attachments specifically), or a named attachment/file chip
 * (text-file uploads, and some image UIs that show a filename pill instead
 * of a thumbnail). Callers with a known, narrower selector (e.g. Copilot's
 * `[aria-label^="Attachment"]` chip) should pass `verifySelector` instead.
 */
export const DEFAULT_ATTACHMENT_EVIDENCE =
  'img[src^="blob:" i], [class*="attachment" i], [class*="thumbnail" i], ' +
  '[aria-label*="attachment" i], [aria-label^="Attachment" i], ' +
  '[data-testid*="attachment" i], [class*="file-preview" i], [class*="filePreview" i]';

/**
 * Wait for visible evidence that a file landed in the composer. Returns
 * true/false — never throws — so callers can decide what "not verified"
 * means for their turn instead of it being swallowed here.
 */
export async function waitForAttachmentEvidence(page, options = {}) {
  const { selector = DEFAULT_ATTACHMENT_EVIDENCE, timeoutMs = 6000 } = options;
  try {
    await page
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export async function uploadFileToPage(page, filePath, options = {}) {
  const {
    attachmentBtnSelector = null,
    timeoutMs = 8000,
    verifySelector = null,
    verifyTimeoutMs = 6000,
  } = options;

  // Verify the file exists before attempting upload
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Upload file not found: ${filePath}`);
  }

  const verify = () =>
    waitForAttachmentEvidence(page, {
      selector: verifySelector || DEFAULT_ATTACHMENT_EVIDENCE,
      timeoutMs: verifyTimeoutMs,
    });

  // Strategy 1: Direct setInputFiles on existing hidden file input
  try {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      await fileInputs.first().setInputFiles(filePath);
      await page.waitForTimeout(500);
      if (await verify()) {
        logger.info(
          `[UploadFile] Set files directly on input[type="file"] (${filePath}) — attachment confirmed`,
        );
        return true;
      }
      logger.debug(
        `[UploadFile] setInputFiles on input[type="file"] did not throw, but no attachment evidence appeared — trying the chooser strategy instead of trusting it.`,
      );
    }
  } catch (err) {
    logger.debug(
      `[UploadFile] Direct file input strategy failed: ${err.message}`,
    );
  }

  // Strategy 2: Click attachment button → intercept file chooser
  const btnSelector =
    attachmentBtnSelector ||
    'button[aria-label*="attach" i], button[aria-label*="upload" i], button[aria-label*="file" i], ' +
      'button[title*="attach" i], button[title*="upload" i], ' +
      '[class*="upload" i] button, [class*="attach" i] button';

  try {
    const btn = page.locator(btnSelector).first();
    const btnVisible = await btn
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (btnVisible) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: timeoutMs }),
        btn.click(),
      ]);
      await fileChooser.setFiles(filePath);
      await page.waitForTimeout(500);
      if (await verify()) {
        logger.info(
          `[UploadFile] Set files via file chooser (${filePath}) — attachment confirmed`,
        );
        return true;
      }
      logger.warn(
        `[UploadFile] File chooser accepted the file but no attachment evidence appeared on the page.`,
      );
      return false;
    }
  } catch (err) {
    logger.debug(`[UploadFile] File chooser strategy failed: ${err.message}`);
  }

  throw new Error(
    `Could not upload file: no file input or attachment button found on page`,
  );
}
