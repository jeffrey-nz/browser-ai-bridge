import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { AI_MODES, resolveModeKey } from "#ai/modes.js";

// T-048: deepseek's default text mode ("Instant") cannot read an attached
// image at all — confirmed live: 5/5 pinned-fixture image turns in Instant
// mode came back "SEES=no" in a suspiciously tight ~51.3s band (45ms
// spread across 5 runs), and the page's own composer shows a
// "No text found. Try Vision." banner during that same window. This is a
// THIRD selector, separate from the DeepThink/Standard toggle setMode()
// already handles — a `role="radiogroup"` of three `role="radio"` options
// (Instant / Expert / Vision) sitting in the composer toolbar, found by
// live DOM inspection (nothing in this repo had ever looked for it before
// this ticket). Selecting "Vision" and resending the identical pinned
// fixture turned every one of those failures into a genuine PASS
// (SEES=yes COUNT=5 COLOR=crimson, live-verified).
export async function selectDeepSeekVisionMode(page) {
  const vision = page.locator('[role="radio"]:has-text("Vision")').first();
  try {
    await vision.waitFor({ state: "visible", timeout: 10000 });
    const isCurrentlyOn =
      (await vision.getAttribute("aria-checked")) === "true";
    if (!isCurrentlyOn) {
      await vision.click();
      log(`  ${colors.green("✔")} DeepSeek Vision mode selected.`);
    } else {
      log(`  ${colors.blue("ℹ")} DeepSeek Vision mode already selected.`);
    }
  } catch (err) {
    log(
      colors.yellow(
        `  ⚠️  DeepSeek Vision mode radio not found — sending the image without it (this is the pre-T-048 behaviour, likely to come back "SEES=no").`,
      ),
    );
  }
}

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
