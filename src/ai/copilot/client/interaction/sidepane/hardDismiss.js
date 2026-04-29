import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function hardDismissWidgets(page) {
  try {
    const nodesRemoved = await page.evaluate(() => {
      let count = 0;
      const stubbornWidgets = document.querySelectorAll(
        [
          '[data-testid="pages-sidepane"]',
          '.fai-RecallCard',
          '[data-testid="recall-card-test-id"]',
          // Microsoft Designer image embeds
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
      await page.waitForTimeout(500);
      return true;
    }
  } catch (e) {}
  return false;
}
