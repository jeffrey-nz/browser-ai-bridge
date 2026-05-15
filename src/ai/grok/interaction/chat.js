import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function startNewChat(page) {
  log(`\n🧹 Starting a new chat context...`);
  const btn = page
    .locator("a[href='/imagine'], a[href='/c#private'], a[href='/']")
    .first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Plain click() fails in offscreen-window mode because Playwright keeps
    // reporting "element is outside of the viewport" even after scrollIntoView.
    // Force a programmatic click which bypasses viewport/visibility checks.
    try {
      await btn.click({ timeout: 5000 });
    } catch {
      await btn
        .evaluate((el) => el.click())
        .catch(async () => {
          await page.goto("https://grok.com/", {
            waitUntil: "domcontentloaded",
          });
        });
    }
  } else {
    await page.goto("https://grok.com/", { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(2000);
  log(`  ${colors.green("✔")} Clean context established.`);
}
