import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { AI_MODES, resolveModeKey } from "#ai/modes.js";

export async function setDeepSeekMode(page, rawModeKey) {
  const modeKey = resolveModeKey(rawModeKey);
  const isThinking = modeKey === AI_MODES.THINKING;

  log(
    `\n⚙️  Setting DeepSeek mode: ${colors.bold(isThinking ? "DeepThink (R1)" : "Standard (V3)")}...`,
  );

  const toggle = page
    .locator('.ds-toggle-button:has-text("Deep thinking")')
    .first();

  try {
    await toggle.waitFor({ state: "visible", timeout: 10000 });

    const isCurrentlyOn = await toggle.evaluate((el) =>
      el.classList.contains("ds-toggle-button--selected"),
    );

    if (isThinking !== isCurrentlyOn) {
      await toggle.click();
      log(`  ${colors.green("✔")} Mode switched.`);
    } else {
      log(`  ${colors.blue("ℹ")} Mode already correct.`);
    }
  } catch (err) {
    log(
      colors.yellow(
        `  ⚠️  DeepThink toggle not found. Proceeding with current state.`,
      ),
    );
  }

  // Always ensure web Search is OFF. When Search is enabled, DeepSeek augments
  // replies with web results and conversational framing, which corrupts the
  // strict-JSON responses callers expect (the reply parses as garbage and the
  // turn is wasted). The Search toggle can get left on across sessions, so we
  // proactively turn it off on every prompt rather than assume a clean state.
  const searchToggle = page
    .locator('.ds-toggle-button:has-text("Search")')
    .first();
  try {
    await searchToggle.waitFor({ state: "visible", timeout: 5000 });
    const searchOn = await searchToggle.evaluate((el) =>
      el.classList.contains("ds-toggle-button--selected"),
    );
    if (searchOn) {
      await searchToggle.click();
      log(`  ${colors.green("✔")} Web Search disabled (was on).`);
    }
  } catch (err) {
    log(
      colors.yellow(
        `  ⚠️  Search toggle not found. Proceeding with current state.`,
      ),
    );
  }
}
