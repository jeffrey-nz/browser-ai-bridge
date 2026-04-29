import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { performSubmitWithRetry } from "../submit.js";
import { getChatInputArea } from "../inputLocator.js";
import { dismissSidePane } from "../../sidepane.js";
import { waitForCompletion } from "../poll/index.js";

export async function injectAndSubmit(page, text) {
  await dismissSidePane(page);

  const stopBtn = page
    .locator('button[aria-label*="Stop"], button[title*="Stop"]')
    .last();
  if (await stopBtn.isVisible().catch(() => false)) {
    log(
      colors.yellow(
        `  [Submit] AI is still generating — clicking Stop to interrupt before injecting...`,
      ),
    );
    await stopBtn.click({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // If clicking stop didn't work, wait for it to finish naturally (but cap at 30s)
    if (await stopBtn.isVisible().catch(() => false)) {
      log(
        colors.dim(
          `  [Submit] Stop click had no effect — waiting for generation to end...`,
        ),
      );
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (!(await stopBtn.isVisible().catch(() => false))) break;
        await page.waitForTimeout(1000);
      }
    }
  }

  const textArea = await getChatInputArea(page);
  const submitResult = await performSubmitWithRetry(page, textArea, text);

  if (!submitResult.success) {
    log(
      colors.yellow(
        `  [Auto-recovery] Submission failed — reloading page to clear stuck UI...`,
      ),
    );

    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (reloadErr) {
      log(
        colors.yellow(
          `  (Reload timed out: ${reloadErr.message}. Attempting to continue...)`,
        ),
      );
    }

    await page.waitForTimeout(3000);

    const freshTextArea = await getChatInputArea(page);
    const finalSubmitResult = await performSubmitWithRetry(
      page,
      freshTextArea,
      text,
    );

    if (!finalSubmitResult.success) {
      throw new Error("Submission failed after UI recovery attempt.");
    }
    return finalSubmitResult;
  }

  return submitResult;
}
