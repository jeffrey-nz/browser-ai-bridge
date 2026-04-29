import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

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
