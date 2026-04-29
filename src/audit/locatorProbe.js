import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

/**
 * For each named locator in locs, reports how many elements match and whether
 * the last one is visible. Runs after a step abort to give Claude a diagnostic
 * snapshot of which selectors are alive vs broken.
 */
export async function runLocatorProbe(page, locs, providerName) {
  log(colors.cyan(`\n  [PROBE] Locator diagnostics for ${providerName}:`));

  const entries = Object.entries(locs);

  for (const [key, selector] of entries) {
    if (!selector || typeof selector !== "string") continue;

    // Each locator may be a comma-joined list; report the compound result.
    try {
      const count = await page.locator(selector).count();
      if (count === 0) {
        log(colors.red(`    ${key}: 0 matches — selector broken`));
        continue;
      }
      const lastVisible = await page
        .locator(selector)
        .last()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const tag = lastVisible
        ? colors.green("visible")
        : colors.yellow("hidden");
      log(colors.dim(`    ${key}: ${count} match(es), last=${tag}`));
    } catch (err) {
      log(colors.red(`    ${key}: probe error — ${err.message}`));
    }
  }

  // Dump all visible buttons with aria-label or data-testid for manual diagnosis.
  try {
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button, [role='button']"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => {
          const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("data-testid") ||
            el.textContent?.trim().slice(0, 40) ||
            "(unlabelled)";
          return label;
        })
        .filter((v, i, a) => v && a.indexOf(v) === i)
        .slice(0, 30);
    });

    if (buttons.length > 0) {
      log(
        colors.dim(
          `    visible buttons: ${buttons.map((b) => `"${b}"`).join(", ")}`,
        ),
      );
    }
  } catch (_) {}
}
