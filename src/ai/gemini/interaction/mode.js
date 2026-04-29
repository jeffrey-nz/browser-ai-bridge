import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { PROVIDER_MODES, AI_MODES, resolveModeKey } from "#ai/modes.js";
import { capturePageSnapshot } from "#ai/shared/captureSnapshot.js";

const GEMINI_FALLBACK_ORDER = [AI_MODES.PRO, AI_MODES.THINKING, AI_MODES.FAST];

function getNextFallback(modeKey) {
  const idx = GEMINI_FALLBACK_ORDER.indexOf(modeKey);
  return idx !== -1 && idx + 1 < GEMINI_FALLBACK_ORDER.length
    ? GEMINI_FALLBACK_ORDER[idx + 1]
    : null;
}

async function fallback(modeKey, reason) {
  const nextKey = getNextFallback(modeKey);
  if (nextKey) {
    const nextLabel = PROVIDER_MODES.gemini[nextKey]?.label ?? nextKey;
    log(`  ${colors.yellow("→")} ${reason} — falling back to "${nextLabel}"...`);
    return nextKey;
  }
  log(`  ${colors.dim(`${reason} — no further fallback, continuing in current mode.`)}`);
  return null;
}

export async function setGeminiMode(page, rawModeKey = AI_MODES.AUTO) {
  const modeKey = resolveModeKey(rawModeKey);
  await trySetGeminiMode(page, modeKey);
}

async function trySetGeminiMode(page, modeKey) {
  const config =
    PROVIDER_MODES.gemini[modeKey] || PROVIDER_MODES.gemini[AI_MODES.AUTO];

  log(`\n⚙️  Setting Gemini mode to: ${colors.bold(config.label)}...`);

  const switcher = page.locator('[data-test-id="bard-mode-menu-button"]');

  try {
    await switcher.waitFor({ state: "visible", timeout: 15000 });

    const labelSpan = switcher
      .locator('[data-test-id="logo-pill-label-container"] span')
      .first();
    const currentText = (await labelSpan.innerText().catch(() => "")).trim();

    if (currentText.toLowerCase() === config.label.toLowerCase()) {
      log(`  ${colors.blue("ℹ")} Mode "${currentText}" is already active.`);
      return;
    }

    log(`  ${colors.dim(`Current: "${currentText}". Switching to "${config.label}"...`)}`);

    let verified = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await switcher.click({ force: true });
        await page.waitForTimeout(600);

        const option = page.locator(`[data-test-id="${config.testId}"]`).first();
        await option.waitFor({ state: "visible", timeout: 6000 });

        // Already active?
        const isCurrent =
          (await option.getAttribute("aria-current").catch(() => null)) === "true";
        if (isCurrent) {
          await page.keyboard.press("Escape");
          log(`  ${colors.blue("ℹ")} Mode "${config.label}" is already active (aria-current).`);
          verified = true;
          break;
        }

        // Disabled = unavailable on this plan — detect before clicking.
        // Gemini marks unavailable modes with aria-disabled="true" and the
        // HTML disabled attribute directly on the button (no separate upsell element).
        const isDisabled =
          (await option.getAttribute("aria-disabled").catch(() => null)) === "true" ||
          (await option.getAttribute("disabled").catch(() => null)) !== null;

        if (isDisabled) {
          await page.keyboard.press("Escape");
          const nextKey = await fallback(modeKey, `"${config.label}" is not available on this plan`);
          if (nextKey) await trySetGeminiMode(page, nextKey);
          return;
        }

        await option.click({ force: true });
        await page.waitForTimeout(800);

        // Confirm via aria-current on the option (more reliable than label text).
        const nowActive =
          (await option.getAttribute("aria-current").catch(() => null)) === "true";
        if (nowActive) {
          log(`  ${colors.green("✔")} Mode confirmed: ${config.label}`);
          verified = true;
          break;
        }

        // Fallback: poll the pill label for up to 7s.
        for (let i = 0; i < 14; i++) {
          await page.waitForTimeout(500);
          const updatedText = (await labelSpan.innerText().catch(() => "")).trim();
          if (updatedText.toLowerCase() === config.label.toLowerCase()) {
            verified = true;
            break;
          }
        }

        if (verified) {
          log(`  ${colors.green("✔")} Mode confirmed: ${config.label}`);
          break;
        } else {
          const still = (await labelSpan.innerText().catch(() => "?")).trim();
          throw new Error(`Label did not update after click. Still shows: "${still}"`);
        }
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          log(`  ${colors.dim(`Attempt ${attempt} failed (${err.message}). Retrying in 2s...`)}`);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
    }

    if (!verified) {
      log(`  ${colors.yellow("⚠️")} Mode selection failed after 3 attempts: ${lastError?.message}`);
      await page.keyboard.press("Escape").catch(() => {});
      await capturePageSnapshot(page, `Mode Switch Failure: ${config.label}`);
    }
  } catch (err) {
    log(`  ${colors.yellow("⚠️")} Mode selection failed: ${err.message}`);
    await page.keyboard.press("Escape").catch(() => {});
    await capturePageSnapshot(page, `Mode Switch Failure: ${err.message}`);
  }

  await page.waitForTimeout(500);
}
