import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

// DeepSeek renamed "DeepThink" → "Deep thinking" (div.ds-toggle-button).
const TOGGLE_SEL =
  '.ds-toggle-button:has-text("Deep thinking"), [class*="toggle-button"]:has-text("Deep thinking"), div[role="button"]:has-text("Deep thinking"), [aria-label*="DeepThink" i], .ds-toggle-button:has-text("DeepThink")';

async function isToggleOn(toggle) {
  return toggle
    .evaluate((el) => {
      return (
        el.classList.contains("ds-toggle-button--selected") ||
        el.getAttribute("aria-pressed") === "true" ||
        el.getAttribute("data-state") === "on"
      );
    })
    .catch(() => false);
}

export async function stepDeepSeekModeToggle(page) {
  log(
    colors.cyan(
      `\n  → Mode Toggles: testing DeepSeek fast / expert selection...`,
    ),
  );

  const toggle = page.locator(TOGGLE_SEL).first();
  const found = await toggle.isVisible({ timeout: 4000 }).catch(() => false);

  if (!found) {
    log(colors.yellow(`  ↳ DeepThink toggle not found on page.`));
    return false;
  }

  log(colors.dim(`  ↳ Toggle found — testing each mode...`));

  let passed = 0;

  // --- Expert mode (DeepThink ON) ---
  try {
    if (!(await isToggleOn(toggle))) {
      await toggle.click({ force: true });
      await page.waitForTimeout(600);
    }
    if (await isToggleOn(toggle)) {
      log(colors.green(`    [expert / DeepThink R1] ✓ Activated`));
      passed++;
    } else {
      log(
        colors.yellow(
          `    [expert / DeepThink R1] Toggle click did not activate`,
        ),
      );
    }
  } catch (err) {
    log(colors.red(`    [expert / DeepThink R1] Error: ${err.message}`));
  }

  // --- Fast mode (DeepThink OFF) ---
  try {
    if (await isToggleOn(toggle)) {
      await toggle.click({ force: true });
      await page.waitForTimeout(600);
    }
    if (!(await isToggleOn(toggle))) {
      log(colors.green(`    [fast / V3 standard] ✓ Activated`));
      passed++;
    } else {
      log(
        colors.yellow(
          `    [fast / V3 standard] Toggle click did not deactivate`,
        ),
      );
    }
  } catch (err) {
    log(colors.red(`    [fast / V3 standard] Error: ${err.message}`));
  }

  return passed > 0;
}
