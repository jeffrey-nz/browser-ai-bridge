import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { COPILOT_365_LOCATORS } from "../../locators.js";

export async function softDismissWidgets(page) {
  let dismissedAny = false;

  const fromLocators = COPILOT_365_LOCATORS.closePageWidgetBtn
    ? COPILOT_365_LOCATORS.closePageWidgetBtn.split(",").map((s) => s.trim())
    : [];

  const pageWidgetSelectors = [
    '[data-testid="discardButton"]',
    ...fromLocators,
    '[data-testid="pages-sidepane"] button[aria-label="Close"]',
    '[data-testid="pages-sidepane"] button',
    '[aria-label*="Canvas" i] button[aria-label*="Close" i]',
    // RHS document panel close buttons (Pages split-panel layout)
    'button[aria-label="Close panel"]',
    'button[aria-label="Close sidebar"]',
    'button[aria-label="Dismiss panel"]',
    'button[aria-label*="close" i][aria-label*="panel" i]',
    '#m365-copilot-app-layout-content button[aria-label*="Close" i]',
  ];

  try {
    for (const sel of pageWidgetSelectors) {
      const closeBtn = page.locator(sel).first();

      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        log(
          `\n${colors.yellow("⚠️")} Page widget detected — closing (${sel})...`,
        );
        await closeBtn.click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1000);
        dismissedAny = true;
        break;
      }
    }
  } catch (err) {
    log(
      colors.dim(
        `  [SidePane] Error attempting to close page widget: ${err.message}`,
      ),
    );
  }

  const drawer = page.locator(COPILOT_365_LOCATORS.navDrawer).first();
  const collapseBtn = page.locator(COPILOT_365_LOCATORS.navCollapseBtn).first();

  try {
    if (await drawer.isVisible({ timeout: 300 }).catch(() => false)) {
      if (await collapseBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        log(
          `${colors.yellow("⚠️")} Navigation sidebar detected — collapsing...`,
        );
        await collapseBtn.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(700);
        dismissedAny = true;
      }
    }
  } catch (err) {
    log(
      colors.dim(
        `  [SidePane] Error attempting to collapse nav drawer: ${err.message}`,
      ),
    );
  }

  if (!dismissedAny) {
    log(
      colors.dim(
        `  [SidePane] No explicit panes detected — trying Escape key...`,
      ),
    );
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  return dismissedAny;
}
