import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { COPILOT_365_LOCATORS } from "../locators.js";

const GROUNDING_MENU_SELECTOR =
  '[data-testid="grounding-menu"], [data-test-id="grounding-menu-agent-menu"], [role="menu"][aria-label*="agent" i]';

export async function dismissGroundingMenus(page) {
  const isOpen = await page
    .locator(GROUNDING_MENU_SELECTOR)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);

  if (isOpen) {
    log(
      colors.dim(
        `  [Input] Grounding/agent menu detected — pressing Escape to dismiss...`,
      ),
    );
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(350);
    return true;
  }
  return false;
}

export async function dismissSidePane(page) {
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
  ];

  try {
    for (const sel of pageWidgetSelectors) {
      const closeBtn = page.locator(sel).first();

      const isVisible = await closeBtn
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      if (isVisible) {
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
    const isDrawerVisible = await drawer
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (isDrawerVisible) {
      const isBtnVisible = await collapseBtn
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (isBtnVisible) {
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

  try {
    const nodesRemoved = await page.evaluate(() => {
      let count = 0;
      const stubbornWidgets = document.querySelectorAll(
        [
          '[data-testid="pages-sidepane"]',
          ".fai-RecallCard",
          '[data-testid="recall-card-test-id"]',
          '[id^="designer-host-"]',
          'iframe[src*="designer.svc.cloud.microsoft"]',
          'iframe[name="Microsoft Designer"]',
        ].join(", "),
      );
      stubbornWidgets.forEach((el) => {
        el.remove();
        count++;
      });
      return count;
    });

    if (nodesRemoved > 0) {
      log(
        colors.yellow(
          `  [SidePane] Aggressive DOM clear: forcefully removed ${nodesRemoved} stubborn widget node(s).`,
        ),
      );
      dismissedAny = true;
      await page.waitForTimeout(500);
    }
  } catch (e) {}

  return dismissedAny;
}
