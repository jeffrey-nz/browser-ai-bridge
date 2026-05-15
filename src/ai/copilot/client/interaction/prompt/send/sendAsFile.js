/**
 * Send a long prompt to Copilot as a file attachment.
 *
 * Copilot's web UI has a hard 10,240-character input limit (enforced by the
 * "Message exceeds 10240 characters." banner — submit button gets disabled).
 * The chunker approach doesn't work because Copilot does not reliably emit
 * the inter-chunk acknowledgement the chunker expects.
 *
 * Instead, for any prompt larger than the input limit we:
 *   1. Write the full prompt to a temp .txt file
 *   2. Upload it via the hidden composer-file-input element
 *   3. Inject a short cover message into the textarea pointing at the file
 *   4. Click submit
 *
 * Copilot reads attached .txt files as conversational context, so the model
 * receives the full prompt and responds normally.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

const COVER_MESSAGE =
  "The full instructions for this turn are in the attached file. " +
  "Read it carefully and respond in this chat as plain text or a JSON code block.";

/**
 * Returns true if the long-prompt-as-file path succeeded end to end.
 * Returns false on any failure so the caller can fall back to the legacy
 * chunker path.
 */
export async function sendPromptAsFile(page, fullText) {
  const tmpName = `copilot-prompt-${crypto.randomBytes(6).toString("hex")}.txt`;
  const tmpPath = path.join(os.tmpdir(), tmpName);
  await fs.writeFile(tmpPath, fullText, "utf8");

  try {
    log(
      colors.dim(
        `  [Copilot] Prompt is ${fullText.length} chars — uploading as ${tmpName} (UI limit is ~10240).`,
      ),
    );

    const fileInput = page
      .locator('[data-testid="composer-file-input"], input[type="file"]')
      .first();
    await fileInput.setInputFiles(tmpPath, { timeout: 5000 });

    // Wait for the attachment chip to appear in the composer.
    const attachmentChip = page.locator('[aria-label^="Attachment"]').first();
    await attachmentChip.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});

    // Inject the short cover message.
    const textarea = page.locator('[data-testid="composer-input"]').first();
    await textarea.click({ force: true }).catch(() => {});
    await textarea.fill(COVER_MESSAGE, { timeout: 5000 });
    await page.waitForTimeout(300);

    // Click submit; fall back to Enter if the button isn't there.
    const submit = page.locator('[data-testid="submit-button"]').first();
    const submitVisible = await submit.isVisible({ timeout: 3000 }).catch(() => false);
    if (submitVisible) {
      await submit.click({ force: true });
    } else {
      await textarea.focus();
      await textarea.press("Enter");
    }

    return true;
  } catch (err) {
    log(
      colors.yellow(
        `  [Copilot] File-upload prompt path failed: ${err.message?.slice(0, 120)}`,
      ),
    );
    return false;
  } finally {
    // Don't block the response wait on cleanup.
    fs.unlink(tmpPath).catch(() => {});
  }
}
