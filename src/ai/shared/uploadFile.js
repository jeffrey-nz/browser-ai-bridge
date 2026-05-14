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
 */

import { logger } from "#utils/logger.js";
import fs from "node:fs/promises";

export async function uploadFileToPage(page, filePath, options = {}) {
  const { attachmentBtnSelector = null, timeoutMs = 8000 } = options;

  // Verify the file exists before attempting upload
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Upload file not found: ${filePath}`);
  }

  // Strategy 1: Direct setInputFiles on existing hidden file input
  try {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      await fileInputs.first().setInputFiles(filePath);
      logger.info(
        `[UploadFile] Set files directly on input[type="file"] (${filePath})`,
      );
      await page.waitForTimeout(1500);
      return true;
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
      logger.info(`[UploadFile] Set files via file chooser (${filePath})`);
      await page.waitForTimeout(1500);
      return true;
    }
  } catch (err) {
    logger.debug(`[UploadFile] File chooser strategy failed: ${err.message}`);
  }

  throw new Error(
    `Could not upload file: no file input or attachment button found on page`,
  );
}
