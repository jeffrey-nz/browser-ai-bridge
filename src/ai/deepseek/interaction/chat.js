import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { DEEPSEEK_LOCATORS } from "../locators.js";

export async function startNewChat(page) {
  log(`\n🔄 Starting a new DeepSeek chat context...`);

  const newChatBtn = page.locator(DEEPSEEK_LOCATORS.newChatBtn).first();
  const input = page.locator(DEEPSEEK_LOCATORS.inputBox).last();

  try {
    // Give the sidebar more time to settle — 5s instead of 2s
    await newChatBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

    if (await newChatBtn.isVisible()) {
      await newChatBtn.click({ force: true, timeout: 3000 });
    } else {
      // Sidebar not loaded — navigate to fresh page
      await page.goto("https://chat.deepseek.com/", { waitUntil: "domcontentloaded" });
    }

    // Wait for input to be ready
    await input.waitFor({ state: "visible", timeout: 10000 });
    // Brief settle — DeepSeek sometimes keeps loading after input appears
    await page.waitForTimeout(500);

    log(`  ${colors.green("✔")} Clean context established.`);
  } catch {
    log(colors.yellow("  ⚠️  Failed to start new chat via UI. Reloading page..."));
    await page.goto("https://chat.deepseek.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    // Final attempt to wait for input
    await input.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  }
}
