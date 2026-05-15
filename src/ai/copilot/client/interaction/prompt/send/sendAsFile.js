/**
 * Send a long prompt to Copilot as a file attachment.
 *
 * Copilot's web UI hard-caps the textarea at ~10,240 chars (banner:
 * "Message exceeds 10240 characters." disables submit). Anything larger
 * is uploaded as a .txt and a short cover message is sent alongside.
 *
 * Strategy is layered to survive navigations / fresh chats:
 *   1. Direct setInputFiles on the hidden composer-file-input. Works most
 *      of the time but the element can be detached after navigation.
 *   2. Click the "+" composer-create-button → "Add images or files"
 *      menuitem → intercept the OS filechooser event. Works as long as
 *      the menu is reachable.
 *   3. Verify an attachment chip really appeared. If it didn't, give up
 *      and let the caller fall back to the legacy chunker path.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { truncateBlocks } from "../compactor/truncators/blocks.js";

// Copilot's file reader caps each attachment at roughly 25k characters — beyond
// that it reports the file as truncated ("IsTruncated=true") and the model only
// sees the head, missing the OUTPUT FORMAT section that comes near the end of
// an agent prompt. We pre-trim heavy blocks (file contents, tool histories) so
// the prompt fits without losing the directives the model needs to follow.
const COPILOT_FILE_SOFT_CAP = 22000;

// The cover message has to FIGHT for the model's attention against the big
// attached prompt. The mid-prompt trim sometimes drops the OUTPUT FORMAT
// section, so we ALSO try to extract it and embed it verbatim in the cover.
const COVER_MESSAGE_BASE =
  "The attached .txt file is your COMPLETE system prompt for THIS turn — " +
  "not a document to summarise.\n\n" +
  "REQUIREMENTS for your reply:\n" +
  "1. Find the OUTPUT FORMAT / OUTPUT: / 'output the JSON' instructions " +
  "inside the file and OBEY THEM EXACTLY.\n" +
  "2. Use the EXACT JSON keys and array shape the file requires. Do NOT " +
  "invent new keys like 'goal' or 'success_criteria' unless the file " +
  "asks for them.\n" +
  "3. If the file asks for a JSON array of tool calls, output ONLY the " +
  "array — no prose before or after.\n" +
  "4. If the file asks for an object with a 'subtasks' array, output that " +
  "object with the array fully populated.\n" +
  "5. Reply in this chat directly. Plain text or a single ```json``` " +
  "code block. No external documents.";

/**
 * Pull the OUTPUT FORMAT block out of an agent prompt so we can echo it in
 * the cover message. Heuristic: header line `OUTPUT FORMAT:` or `OUTPUT:`
 * followed by up to 30 non-blank lines or 1800 chars. Returns "" if not
 * found.
 */
function extractOutputFormat(promptText) {
  const m = promptText.match(
    /^[ \t]*OUTPUT(?:[ _]FORMAT)?\s*:[ \t]*\n([\s\S]{1,1800}?)(?:\n[ \t]*(?:CRITICAL RULES|NEW PROJECT|CSS FILE|REACT|VITE|SECURITY|EXAMPLES|---|$))/im,
  );
  if (m && m[1]) return m[1].trim();
  // Fallback: any block that starts with the magic phrase, capped at 1500
  // chars so we don't drown the cover message.
  const m2 = promptText.match(
    /OUTPUT(?:[ _]FORMAT)?:[ \t]*\n([\s\S]{1,1500})/i,
  );
  return m2?.[1]?.trim() || "";
}

function buildCoverMessage(promptText) {
  const fmt = extractOutputFormat(promptText);
  if (!fmt) return COVER_MESSAGE_BASE;
  return (
    COVER_MESSAGE_BASE +
    "\n\n" +
    "REMINDER OF THE EXACT OUTPUT FORMAT (verbatim from the attached file " +
    "— follow this, not your own interpretation):\n\n" +
    fmt
  );
}

async function waitForAttachmentChip(page, timeoutMs = 6000) {
  const chip = page.locator('[aria-label^="Attachment"]').first();
  try {
    await chip.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * After the chip is visible, Copilot still has to finish uploading the file to
 * its server. Submitting too early means the assistant sees an empty document
 * list. Wait until either:
 *   - the chip stops showing progress indicators (any [role="progressbar"]
 *     inside it disappears), AND it doesn't say "Uploading"/"Loading", OR
 *   - the submit-button becomes enabled (it's disabled during upload), OR
 *   - the fixed budget elapses (safety net).
 */
async function waitForUploadComplete(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  // Minimum wait — even if all signals say "done" early, Copilot's
  // server-side ingestion needs at least a few seconds for a 22k file.
  const MIN_WAIT_MS = 2500;
  while (Date.now() < deadline) {
    const stillUploading = await page
      .evaluate(() => {
        const chip = document.querySelector('[aria-label^="Attachment"]');
        if (!chip) return false;
        if (chip.querySelector('[role="progressbar"]')) return true;
        const t = (chip.textContent || "").toLowerCase();
        if (/uploading|loading|processing/.test(t)) return true;
        return false;
      })
      .catch(() => false);
    const elapsed = Date.now() - startedAt;
    if (!stillUploading && elapsed >= MIN_WAIT_MS) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function uploadViaHiddenInput(page, filePath) {
  try {
    const fileInput = page
      .locator('[data-testid="composer-file-input"], input[type="file"]')
      .first();
    await fileInput.waitFor({ state: "attached", timeout: 4000 });
    await fileInput.setInputFiles(filePath, { timeout: 5000 });
    return await waitForAttachmentChip(page, 6000);
  } catch (err) {
    log(
      colors.dim(
        `  [Copilot] Direct setInputFiles failed: ${err.message?.slice(0, 100)}`,
      ),
    );
    return false;
  }
}

async function uploadViaPlusMenu(page, filePath) {
  try {
    const plus = page
      .locator('[data-testid="composer-create-button"]')
      .first();
    await plus.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(400);

    // The menu item is the one with aria-label / data-testid mentioning files.
    const candidates = [
      '[data-testid="add-images-files"]',
      '[role="menuitem"]:has-text("Add images or files")',
      '[role="menuitem"]:has-text("Upload")',
      'button:has-text("Add images or files")',
    ];

    let menuItem = null;
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        menuItem = loc;
        break;
      }
    }
    if (!menuItem) {
      log(colors.dim("  [Copilot] '+' menu opened but no upload item found."));
      return false;
    }

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      menuItem.click({ force: true }),
    ]);
    await chooser.setFiles(filePath);
    return await waitForAttachmentChip(page, 8000);
  } catch (err) {
    log(
      colors.dim(
        `  [Copilot] '+' menu upload failed: ${err.message?.slice(0, 100)}`,
      ),
    );
    return false;
  }
}

/**
 * Returns true if the long-prompt-as-file path was submitted end to end.
 * Returns false on any failure so the caller can fall back.
 */
export async function sendPromptAsFile(page, fullText) {
  // Pre-trim if the prompt would exceed Copilot's file reader cap. We use
  // the existing block truncator which collapses [TOOL RESULT] / [FILE]
  // blocks down to head+tail summaries — preserves the OUTPUT FORMAT
  // section and CRITICAL RULES which always live at the start/end of the
  // prompt.
  let text = fullText;
  if (text.length > COPILOT_FILE_SOFT_CAP) {
    const beforeLen = text.length;
    text = truncateBlocks(text, 1200);
    if (text.length > COPILOT_FILE_SOFT_CAP) {
      // Still too big: hard-trim the middle, keeping head (instructions)
      // and tail (output format). Asymmetric: more head than tail because
      // OUTPUT FORMAT and CRITICAL RULES typically come early/late.
      const head = Math.floor(COPILOT_FILE_SOFT_CAP * 0.55);
      const tail = COPILOT_FILE_SOFT_CAP - head - 200;
      text =
        text.slice(0, head) +
        `\n\n…[${text.length - head - tail} chars trimmed mid-prompt to fit Copilot's file reader]…\n\n` +
        text.slice(-tail);
    }
    log(
      colors.dim(
        `  [Copilot] Prompt trimmed ${beforeLen} → ${text.length} chars for file upload.`,
      ),
    );
  }

  const tmpName = `copilot-prompt-${crypto.randomBytes(6).toString("hex")}.txt`;
  const tmpPath = path.join(os.tmpdir(), tmpName);
  await fs.writeFile(tmpPath, text, "utf8");

  try {
    log(
      colors.dim(
        `  [Copilot] Prompt is ${text.length} chars — uploading as ${tmpName}.`,
      ),
    );

    // Try direct first (fast path), then fall back to "+" menu + filechooser.
    let attached = await uploadViaHiddenInput(page, tmpPath);
    if (!attached) {
      log(colors.dim("  [Copilot] Falling back to '+' menu upload..."));
      attached = await uploadViaPlusMenu(page, tmpPath);
    }
    if (!attached) {
      log(
        colors.yellow(
          "  [Copilot] No attachment chip appeared after both upload strategies — bailing.",
        ),
      );
      return false;
    }
    log(colors.dim("  [Copilot] Attachment chip visible — waiting for server-side upload to complete."));

    // The chip appears as soon as the file is selected, but Copilot uploads
    // to its server asynchronously. If we submit before the upload completes
    // the assistant receives no file ("document list returned empty set").
    const ready = await waitForUploadComplete(page, 15000);
    log(
      ready
        ? colors.dim("  [Copilot] Upload reported complete.")
        : colors.yellow("  [Copilot] Upload-complete signal not detected within 15s — proceeding anyway."),
    );

    // Cover message — include the verbatim OUTPUT FORMAT from the prompt
    // so Copilot doesn't invent its own shape when the trim drops it.
    const coverMessage = buildCoverMessage(text);
    const textarea = page.locator('[data-testid="composer-input"]').first();
    await textarea.click({ force: true }).catch(() => {});
    // The cover can grow past 10k when the OUTPUT FORMAT is large; if so,
    // .fill() still works because the COVER itself is small relative to the
    // file. Slice to 9500 to stay under Copilot's textarea limit.
    await textarea.fill(coverMessage.slice(0, 9500), { timeout: 5000 });
    await page.waitForTimeout(300);

    // Submit.
    const submit = page.locator('[data-testid="submit-button"]:not([disabled])').first();
    const submitVisible = await submit
      .isVisible({ timeout: 3000 })
      .catch(() => false);
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
        `  [Copilot] sendPromptAsFile failed: ${err.message?.slice(0, 120)}`,
      ),
    );
    return false;
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
}
