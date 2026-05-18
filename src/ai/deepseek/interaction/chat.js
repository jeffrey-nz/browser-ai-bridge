import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { DEEPSEEK_LOCATORS } from "../locators.js";

export async function startNewChat(page) {
  log(`\n🔄 Starting a new DeepSeek chat context...`);

  const newChatBtn = page.locator(DEEPSEEK_LOCATORS.newChatBtn).first();
  const input = page.locator(DEEPSEEK_LOCATORS.inputBox).last();

  try {
    // Give the sidebar more time to settle — 5s instead of 2s
    await newChatBtn
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => {});

    if (await newChatBtn.isVisible()) {
      await newChatBtn.click({ force: true, timeout: 3000 });
    } else {
      // Sidebar not loaded — navigate to fresh page
      await page.goto("https://chat.deepseek.com/", {
        waitUntil: "domcontentloaded",
      });
    }

    // Wait for input to be ready
    await input.waitFor({ state: "visible", timeout: 10000 });
    // Brief settle — DeepSeek sometimes keeps loading after input appears
    await page.waitForTimeout(500);

    log(`  ${colors.green("✔")} Clean context established.`);
  } catch {
    log(
      colors.yellow("  ⚠️  Failed to start new chat via UI. Reloading page..."),
    );
    await page.goto("https://chat.deepseek.com/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2500);
    // Final attempt to wait for input
    await input.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  }

  // Disable Smart Search — if enabled it causes DeepSeek to perform web
  // searches before responding, adding 5+ minutes per turn.
  try {
    const smartSearch = page
      .locator('.ds-toggle-button:has-text("Smart Search")')
      .first();
    const isVisible = await smartSearch
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (isVisible) {
      const isSelected = await smartSearch
        .evaluate((el) => el.classList.contains("ds-toggle-button--selected"))
        .catch(() => false);
      if (isSelected) {
        await smartSearch.click();
        log(`  ${colors.green("✔")} Smart Search disabled.`);
      }
    }
  } catch {
    // Non-fatal — Smart Search toggle may not be visible on all DeepSeek versions
  }
}
