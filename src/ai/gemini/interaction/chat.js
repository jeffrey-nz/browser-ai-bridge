import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { GEMINI_LOCATORS } from "../locators.js";

export async function startNewChat(page) {
  // If already on the Gemini app root, the tab is already a blank slate — skip
  // navigation to avoid creating a new conversation entry in the sidebar.
  const url = page.url();
  const isAlreadyFresh =
    url === "https://gemini.google.com/app" ||
    url.startsWith("https://gemini.google.com/app?");

  if (!isAlreadyFresh) {
    log(`\n🧹 Starting a new chat context...`);
    await page.goto("https://gemini.google.com/app", {
      waitUntil: "domcontentloaded",
    });
  }

  // Wait for the input to be ready instead of a fixed timeout
  await page
    .locator(GEMINI_LOCATORS.inputBox)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => page.waitForTimeout(2000));

  // Dismiss any pop-up overlay.
  //   1) Escape — clears in-page overlays (upgrade prompt, side pane).
  //   2) Google's account-chooser iframe (name="account") gets a focused click
  //      on its X close button via frameLocator. Escape and reload don't
  //      reliably dismiss it because it lives in a cross-origin iframe.
  //   3) As a final fallback, click the iframe element itself at its top-right
  //      corner (where the X visually lives) so the underlying button gets
  //      a real mouse event even if the frameLocator selector misses.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);

  const hasAccountChooser = await page
    .evaluate(() => !!document.querySelector('iframe[name="account"]'))
    .catch(() => false);

  if (hasAccountChooser) {
    log(
      colors.dim("  [Gemini] Account chooser detected — attempting dismiss."),
    );

    // Try clicking the X close button inside the iframe via frameLocator.
    let dismissed = false;
    try {
      const closeBtn = page
        .frameLocator('iframe[name="account"]')
        .locator(
          '[aria-label*="Close" i], button[jsname][aria-label*="lose" i]',
        )
        .first();
      if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await closeBtn.click({ timeout: 2000 }).catch(() => {});
        dismissed = true;
      }
    } catch {}

    // Fallback: click the iframe's top-right corner where the X is rendered.
    if (!dismissed) {
      try {
        const box = await page
          .locator('iframe[name="account"]')
          .first()
          .boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width - 24, box.y + 24);
        }
      } catch {}
    }

    await page.waitForTimeout(400);
  }

  if (isAlreadyFresh) {
    log(`  ${colors.green("✔")} Already on fresh context — reusing tab.`);
  } else {
    log(`  ${colors.green("✔")} Clean context established.`);
  }
}
