import { createSpinner } from "#app/ui/spinner.js";
import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

export async function stepGenerationPolling(page, locs) {
  const spinner = createSpinner(
    "Waiting for AI generation to finish...",
  ).start();

  let stopBtnSeen = false;

  for (let i = 0; i < 15; i++) {
    const isGenerating = await page
      .locator(locs.stopBtn)
      .last()
      .isVisible()
      .catch(() => false);

    if (isGenerating) {
      stopBtnSeen = true;
      break;
    }
    await page.waitForTimeout(400);
  }

  if (!stopBtnSeen) {
    // Generation may have completed before the poll loop started (very fast responses).
    // Check doneSignal first, then fall back to responseBlock.
    if (locs.doneSignal) {
      const alreadyDone = await page
        .locator(locs.doneSignal)
        .last()
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      if (alreadyDone) {
        spinner.succeed("Generation complete (instant — done signal pre-visible).");
        return true;
      }
    }
    if (locs.responseBlock) {
      const hasResponse = await page
        .locator(locs.responseBlock)
        .last()
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      if (hasResponse) {
        spinner.succeed("Generation complete (instant — response block pre-visible).");
        return true;
      }
    }
    spinner.fail(
      "Stop button never appeared. The locator is likely broken or generation was instantly blocked.",
    );
    return false;
  }

  for (let i = 0; i < 45; i++) {
    const isGenerating = await page
      .locator(locs.stopBtn)
      .last()
      .isVisible()
      .catch(() => false);

    if (!isGenerating) break;
    await page.waitForTimeout(1000);
  }

  if (locs.doneSignal) {
    for (let i = 0; i < 15; i++) {
      const isDone = await page
        .locator(locs.doneSignal)
        .last()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (isDone) break;
      await page.waitForTimeout(800);
    }
  }

  if (locs.responseText) {
    for (let i = 0; i < 10; i++) {
      const text = await page
        .locator(locs.responseText)
        .last()
        .textContent({ timeout: 500 })
        .catch(() => "");
      if (text && text.trim().length > 0) break;
      await page.waitForTimeout(600);
    }
  }

  spinner.succeed("Generation complete.");
  return true;
}
