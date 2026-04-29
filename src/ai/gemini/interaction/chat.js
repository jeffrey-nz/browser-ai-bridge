import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function startNewChat(page) {
  log(`\n🧹 Starting a new chat context...`);

  const targetUrl = "https://gemini.google.com/app";

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(3000);

  log(`  ${colors.green("✔")} Clean context established.`);
}
