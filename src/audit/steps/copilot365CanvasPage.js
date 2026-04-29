import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";
import { createSpinner } from "#app/ui/spinner.js";
import { CLOSE_BUTTON_CANDIDATES } from "./copilot365/constants.js";
import {
  waitForWidget,
  discoverButtonsNearWidget,
  probeSelectors,
  tryDismiss,
} from "./copilot365/widgetUtils.js";

export async function stepCopilot365CanvasPage(page, locs) {
  log(
    colors.cyan(`\n  → Canvas Page Probe: looking for pages trigger button...`),
  );

  const triggerSel = locs.pagesTriggerBtn;
  const triggerVisible = triggerSel
    ? await page
        .locator(triggerSel)
        .last()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    : false;

  if (triggerVisible) {
    log(
      colors.dim(
        `  ↳ Found pages trigger button (${triggerSel}) — clicking...`,
      ),
    );
    await page
      .locator(triggerSel)
      .last()
      .click({ force: true })
      .catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    log(
      colors.dim(
        `  ↳ No trigger button found — sending page-creation prompt...`,
      ),
    );
    try {
      const input = page.locator(locs.inputBox).last();
      await input.waitFor({ state: "visible", timeout: 4000 });
      await input.click({ force: true });
      await page.keyboard.insertText(
        "Create a new page with the title 'Audit Test' and a one-sentence summary.",
      );
      await page.waitForTimeout(400);
      const send = page.locator(locs.sendBtn).last();
      await send.waitFor({ state: "visible", timeout: 3000 });
      await send.click({ force: true });
    } catch (err) {
      log(colors.red(`  ✖ Could not trigger canvas page: ${err.message}`));
      return false;
    }

    const spinner = createSpinner(
      "  Waiting for page widget generation...",
    ).start();
    await page.waitForTimeout(3000);
    for (let i = 0; i < 30; i++) {
      const generating = await page
        .locator(locs.stopBtn)
        .last()
        .isVisible()
        .catch(() => false);
      if (!generating) break;
      await page.waitForTimeout(1000);
    }
    spinner.succeed("Generation complete.");
  }

  const widgetSel = locs.pageSidePane || locs.pageWidget || "";
  const detectSpinner = createSpinner(
    "  Scanning for Canvas/Page widget...",
  ).start();
  const matched = await waitForWidget(page, widgetSel, 12000);

  if (!matched) {
    detectSpinner.warn(
      "  Canvas/Page widget not detected. The trigger may need a different prompt or account setting.",
    );
    return false;
  }

  detectSpinner.succeed(`  Widget detected via: ${matched}`);

  await discoverButtonsNearWidget(page, matched);

  const closeFound = await probeSelectors(
    page,
    CLOSE_BUTTON_CANDIDATES,
    "Close/Discard candidates",
  );

  if (closeFound.length > 0) {
    await tryDismiss(
      page,
      closeFound.map((b) => b.sel),
      widgetSel,
    );
  } else {
    log(
      colors.yellow(
        `  ⚠ No close button matched — widget left open for inspection.`,
      ),
    );
    return false;
  }

  return true;
}
