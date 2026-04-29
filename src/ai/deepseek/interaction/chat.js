import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { DEEPSEEK_LOCATORS } from "../locators.js";

export async function startNewChat(page) {
  log(`\n🔄 Starting a new DeepSeek chat context...`);

  const newChatBtn = page.locator(DEEPSEEK_LOCATORS.newChatBtn).first();

  try {
    await newChatBtn
      .waitFor({ state: "visible", timeout: 2000 })
      .catch(() => {});

    if (await newChatBtn.isVisible()) {
      await newChatBtn.click({ force: true, timeout: 3000 });
    } else {
      await page.goto("https://chat.deepseek.com/", { waitUntil: "commit" });
    }

    const input = page.locator(DEEPSEEK_LOCATORS.inputBox).last();
    await input.waitFor({ state: "visible", timeout: 8000 });

    log(`  ${colors.green("✔")} Clean context established.`);
  } catch (err) {
    log(
      colors.yellow("  ⚠️  Failed to start new chat via UI. Reloading page..."),
    );

    await page.goto("https://chat.deepseek.com/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);
  }
}
