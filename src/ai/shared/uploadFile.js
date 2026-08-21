/**
 * uploadFile.js — uploads a local file to the currently-open AI chat page.
 *
 * Tries two strategies in order:
 *   1. Direct setInputFiles on any hidden input[type="file"] on the page.
 *   2. Click an attachment/upload button to trigger a file chooser dialog,
 *      then intercept it with Playwright's waitForEvent("filechooser").
 *      Some sites (kimi, mistral — T-030) don't put a real chooser behind
 *      that first click at all: it only opens a menu, and a SECOND,
 *      site-specific click on a menu item is what actually triggers the
 *      chooser. `options.secondClickSelector` names that menu item; when
 *      unset, strategy 2 is exactly the one-click behaviour above.
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
 *
 * PRESENCE ALONE CAN ALSO LIE THE OTHER WAY (T-031): a site can leave an
 * evidence-matching node on the page from an EARLIER, unrelated turn — kimi
 * specifically survives its own "New Chat" transition with a failed or
 * never-sent draft still attached — so a later call's plain presence check
 * can pass without this call's own upload ever landing anything.
 * `options.requireGrowth` asks for more than presence: the evidence
 * selector's match count must grow past what it already was when THIS call
 * started. Left unset, verify() is exactly the presence-only check above.
 */

import { logger } from "#utils/logger.js";
import fs from "node:fs/promises";
import { UPLOAD_CAUSES, UploadOutcomeError } from "./uploadOutcome.js";

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
    // Some sites (kimi, mistral) put the real file input/chooser behind a
    // SECOND click — the attachment button only opens a menu, and this
    // names the menu item that actually triggers the chooser. Left unset,
    // strategy 2 clicks attachmentBtnSelector once, exactly as before.
    secondClickSelector = null,
    timeoutMs = 8000,
    verifySelector = null,
    verifyTimeoutMs = 6000,
    // T-031: some sites (kimi) can leave an evidence-matching node on the
    // page from an EARLIER turn — a failed or never-sent upload's draft
    // that survived a "New Chat" transition instead of clearing with it.
    // requireGrowth makes evidence conditional on the match COUNT growing
    // past what it already was the instant THIS call started, not merely
    // being present — a stale leftover already counted in that baseline
    // can't stand in for this turn's own verification. Left false (every
    // provider but kimi today), verify() is unchanged: presence is enough.
    requireGrowth = false,
  } = options;

  // Verify the file exists before attempting upload
  try {
    await fs.access(filePath);
  } catch {
    throw new UploadOutcomeError(
      `Upload file not found: ${filePath}`,
      UPLOAD_CAUSES.NOT_OFFERED,
    );
  }

  const evidenceSelector = verifySelector || DEFAULT_ATTACHMENT_EVIDENCE;
  const baselineCount = requireGrowth
    ? await page.locator(evidenceSelector).count()
    : 0;

  const verify = async () => {
    if (!requireGrowth) {
      return await waitForAttachmentEvidence(page, {
        selector: evidenceSelector,
        timeoutMs: verifyTimeoutMs,
      });
    }
    // T-034: waitForAttachmentEvidence resolves on the FIRST visible match —
    // a stale node already satisfies that instantly, which let this turn's
    // own upload be judged (count sampled once, immediately) before a real
    // network round trip had any time to land. Poll for the condition
    // requireGrowth actually names — count > baseline — instead of waiting
    // for visibility and sampling once.
    const deadline = Date.now() + verifyTimeoutMs;
    while (Date.now() < deadline) {
      const currentCount = await page.locator(evidenceSelector).count();
      if (currentCount > baselineCount) return true;
      await page.waitForTimeout(300);
    }
    return false;
  };

  // Strategy 1: Direct setInputFiles on existing hidden file input
  //
  // T-038: tracked separately from the strategy's own success/failure so the
  // FINAL throw below (once strategy 2 has also been tried) can tell "a file
  // really was set on an input on this page" apart from "nothing here ever
  // took the file" — collapsing those two was itself the bug this ticket
  // exists to fix (fence 2, world B).
  let landedOnInput = false;
  try {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      await fileInputs.first().setInputFiles(filePath);
      landedOnInput = true;
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
      // The click that actually opens the chooser is either the button
      // itself (one click, the default — unchanged below) or a menu item
      // the button reveals (two clicks, when secondClickSelector is set).
      // Only THAT last click may race the filechooser event; an earlier
      // click that merely opens a menu must be awaited plainly first, or
      // the listener registers after the button's own (non-chooser) click
      // has already resolved.
      let chooserClick;
      if (secondClickSelector) {
        await btn.click();
        const menuItem = page.locator(secondClickSelector).first();
        await menuItem.waitFor({ state: "visible", timeout: timeoutMs });
        chooserClick = () => menuItem.click();
      } else {
        chooserClick = () => btn.click();
      }
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: timeoutMs }),
        chooserClick(),
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
      throw new UploadOutcomeError(
        `File chooser accepted the file but no attachment evidence appeared within ${verifyTimeoutMs}ms`,
        UPLOAD_CAUSES.UNCONFIRMED,
      );
    }
  } catch (err) {
    if (err instanceof UploadOutcomeError) throw err;
    logger.debug(`[UploadFile] File chooser strategy failed: ${err.message}`);
  }

  // T-038: the message here used to say "no file input ... found" even when
  // strategy 1 (above) DID find one and successfully set the file on it —
  // the condition below tests whether a BUTTON was visible, not whether an
  // input was found, and world B of fence 2 caught the two conflated (a
  // page with a working input and no button was told "no file input"). Say
  // what actually happened: a file already on the page with no confirming
  // evidence and no button fallback is UNCONFIRMED, not NOT_OFFERED.
  if (landedOnInput) {
    throw new UploadOutcomeError(
      `A file was set on input[type="file"] but no attachment evidence appeared, and no attachment button was available as a fallback`,
      UPLOAD_CAUSES.UNCONFIRMED,
    );
  }
  throw new UploadOutcomeError(
    `Could not upload file: no file input and no attachment button were found on page`,
    UPLOAD_CAUSES.NOT_OFFERED,
  );
}
