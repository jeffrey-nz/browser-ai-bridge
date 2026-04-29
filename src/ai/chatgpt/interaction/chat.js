import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function startNewChat(page) {
  log(`\n🧼 Starting a new chat context...`);

  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  log(`  ${colors.green("✔")} Clean context established.`);
}
