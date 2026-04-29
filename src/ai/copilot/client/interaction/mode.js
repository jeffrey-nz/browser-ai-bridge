import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { ensureLocator } from "./ensureLocator.js";
import { PROVIDER_MODES, AI_MODES, resolveModeKey } from "#ai/modes.js";
import { isCopilot365Url } from "../navigation.js";

function resolveProvider(page, explicitProvider) {
  if (explicitProvider) return explicitProvider;
  try {
    const url = page.url();
    if (isCopilot365Url(url)) return "copilot365";
  } catch {}
  return "copilot";
}

export async function setResponseMode(
  page,
  modeKey = AI_MODES.AUTO,
  providerName = null,
) {
  const provider = resolveProvider(page, providerName);
  const resolvedKey = resolveModeKey(modeKey);

  const modeMap =
    provider === "copilot365"
      ? PROVIDER_MODES.copilot365
      : PROVIDER_MODES.copilot;

  const config = modeMap[resolvedKey] || modeMap[AI_MODES.AUTO];

  log(
    `\n${colors.cyan("⚙️")} Setting ${colors.bold(provider)} mode to: ${colors.bold(config.label)}...`,
  );

  const switcher = await ensureLocator(
    page,
    "mode_dropdown_switcher",
    "the main Mode Switcher Dropdown menu",
    () =>
      page
        .locator(
          [
            "#model-select-trigger",
            "#gptModeSwitcher",
            'header button[aria-haspopup="menu"]',
            '[data-testid="composer-chat-mode-smart-button"]',
            'button[aria-label*="Mode" i]',
          ].join(", "),
        )
        .first(),
    { optional: true },
  );

  if (!switcher) {
    log(
      `  ${colors.blue("ℹ️")} Mode switcher not found (UI variant). Skipping mode selection.`,
    );
    return;
  }

  const currentText = (await switcher.innerText().catch(() => ""))
    .trim()
    .split("\n")[0];

  if (currentText && config.regex?.test?.(currentText)) {
    log(
      `  ${colors.blue("ℹ️")} Mode already active (Currently: "${currentText}").`,
    );
    return;
  }

  await switcher.click({ delay: 100 }).catch(() => {});
  await page.waitForTimeout(900);

  const btn = await ensureLocator(
    page,
    config.key,
    `the specific '${config.label}' option`,
    () =>
      page
        .locator('[role="menuitem"], [role="option"], button')
        .filter({ hasText: config.regex })
        .first(),
    { optional: true },
  );

  if (!btn) {
    log(
      `  ${colors.yellow("⚠️")} Target mode option not found. Closing menu and continuing.`,
    );
    await page.keyboard.press("Escape").catch(() => {});
    return;
  }

  await btn.click({ delay: 100 }).catch(() => {});
  log(`  ${colors.green("✅")} Mode selected: ${config.label}`);
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape").catch(() => {});
}
