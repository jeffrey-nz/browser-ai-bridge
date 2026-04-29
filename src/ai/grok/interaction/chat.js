import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function startNewChat(page) {
  log(`\n🧹 Starting a new chat context...`);
  const btn = page
    .locator("a[href='/imagine'], a[href='/c#private'], a[href='/']")
    .first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
  } else {
    await page.goto("https://grok.com/", { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(2000);
  log(`  ${colors.green("✔")} Clean context established.`);
}
