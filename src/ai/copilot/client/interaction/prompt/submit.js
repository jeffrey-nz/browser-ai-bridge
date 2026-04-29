import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { extractLastMessage } from "./extract/index.js";
import { AI_MESSAGE_COUNT_SELECTOR } from "./poll/state.js";
import { injectText } from "./submit/injectText.js";
import { clickSubmit } from "./submit/clickSubmit.js";
import { verifyAcceptance } from "./submit/verifyAcceptance.js";
import { dismissSidePane } from "../sidepane.js";
import { renderDebugDump } from "../debugDump.js";

export async function performSubmitWithRetry(page, textArea, textToSubmit) {
  const previousText = await extractLastMessage(page, {
    optional: true,
    fast: true,
  }).catch(() => "");

  const previousCount = await page
    .evaluate(
      (sel) => document.querySelectorAll(sel).length,
      AI_MESSAGE_COUNT_SELECTOR,
    )
    .catch(() => 0);

  for (let attempt = 1; attempt <= 4; attempt++) {
    // Dismiss any widget/sidepane that may have appeared during a prior attempt
    // or that was present before we started. Called at the top of each iteration
    // so every retry begins from a clean page state.
    await dismissSidePane(page);

    const injected = await injectText(page, textArea, textToSubmit, attempt);
    if (!injected) {
      await page.waitForTimeout(1000);
      continue;
    }

    await clickSubmit(page, textArea);

    const accepted = await verifyAcceptance(
      page,
      textArea,
      previousText,
      previousCount,
    );
    if (accepted) return { success: true, previousText, previousCount };

    if (attempt === 3) {
      log(
        colors.dim(
          `  [Submit] Button stuck, attempting Ctrl+Enter fallback...`,
        ),
      );
      await textArea.focus();
      await page.keyboard.press("Control+Enter");
      await page.waitForTimeout(2000);
    }

    log(
      colors.yellow(
        `  (Submission attempt ${attempt} failed: text still in box. Retrying...)`,
      ),
    );
  }

  await renderDebugDump(
    page,
    "All submission attempts failed — text remained in the input box after clicking submit.",
    "Stuck Submit",
  );
  return { success: false };
}
