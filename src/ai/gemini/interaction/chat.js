import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { GEMINI_LOCATORS } from "../locators.js";

export async function startNewChat(page) {
  log(`\n🧹 Starting a new chat context...`);

  await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });

  // Wait for the input to be ready instead of a fixed timeout
  await page
    .locator(GEMINI_LOCATORS.inputBox)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => page.waitForTimeout(2000));

  log(`  ${colors.green("✔")} Clean context established.`);
}
