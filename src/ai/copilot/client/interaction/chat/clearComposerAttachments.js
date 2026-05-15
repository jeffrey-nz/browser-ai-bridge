import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

/**
 * Click every "Remove file" button in the Copilot composer until the
 * attachment row is empty. Copilot's composer can accumulate stale file
 * attachments from prior turns (e.g. constraint preambles that were
 * uploaded as plain-text files) — these survive `startNewChat` because
 * they live in the composer state, not the conversation. Stale attachments
 * confuse the model and stall subsequent turns.
 *
 * Best-effort: silent no-op if nothing to clear.
 */
export async function clearComposerAttachments(page) {
  const removeSelector = 'button[aria-label^="Remove file"]';

  for (let pass = 0; pass < 10; pass++) {
    const button = page.locator(removeSelector).first();
    const visible = await button.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) {
      if (pass > 0) {
        log(colors.dim(`  [Composer] Cleared ${pass} stale attachment(s).`));
      }
      return;
    }
    await button.click({ force: true }).catch(() => {});
    await page.waitForTimeout(120);
  }

  log(
    colors.yellow(
      "  [Composer] Removed 10 attachments and more were still present — bailing.",
    ),
  );
}
