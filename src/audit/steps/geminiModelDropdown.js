import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

const MODES_TO_TEST = ["fast", "thinking", "pro"];

export async function stepGeminiModelDropdown(page, locs) {
  log(colors.cyan(`\n  → Model Dropdown: testing mode selection...`));

  if (!locs.modeDropdown) {
    log(colors.yellow(`  ↳ No modeDropdown locator defined — skipping.`));
    return false;
  }

  const dropdownVisible = await page
    .locator(locs.modeDropdown)
    .first()
    .isVisible({ timeout: 4000 })
    .catch(() => false);

  if (!dropdownVisible) {
    log(colors.yellow(`  ↳ Mode dropdown not visible on page.`));
    return false;
  }

  log(colors.dim(`  ↳ Dropdown found — testing each mode...`));

  let anyPassed = false;

  for (const mode of MODES_TO_TEST) {
    const optionSel = locs.modes?.[mode];
    if (!optionSel) {
      log(colors.dim(`    [${mode}] No selector defined — skip.`));
      continue;
    }

    // Open dropdown
    try {
      await page.locator(locs.modeDropdown).first().click({ force: true });
      await page.waitForTimeout(600);
    } catch (err) {
      log(colors.red(`    [${mode}] Failed to open dropdown: ${err.message}`));
      continue;
    }

    // Check option visible
    const optionVisible = await page
      .locator(optionSel)
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (!optionVisible) {
      log(colors.yellow(`    [${mode}] Option not visible in dropdown.`));
      // Close dropdown before next iteration
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
      continue;
    }

    // Click the option
    try {
      await page.locator(optionSel).first().click({ force: true });
      await page.waitForTimeout(500);
      log(colors.green(`    [${mode}] ✓ Selected`));
      anyPassed = true;
    } catch (err) {
      log(colors.red(`    [${mode}] Failed to click option: ${err.message}`));
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  return anyPassed;
}
