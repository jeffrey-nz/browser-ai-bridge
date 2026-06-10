import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function startNewChat(page) {
  log(`\n🧹 Starting a new chat context...`);
  const btn = page
    .locator("a[href='/imagine'], a[href='/c#private'], a[href='/']")
    .first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Plain click() fails in offscreen-window mode because Playwright keeps
    // reporting "element is outside of the viewport" even after scrollIntoView.
    // Force a programmatic click which bypasses viewport/visibility checks.
    try {
      await btn.click({ timeout: 5000 });
    } catch {
      await btn
        .evaluate((el) => el.click())
        .catch(async () => {
          await page.goto("https://grok.com/", {
            waitUntil: "domcontentloaded",
          });
        });
    }
  } else {
    await page.goto("https://grok.com/", { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(1500);

  // Dismiss modals that block the input (SuperGrok upsell, "Connect X" banner).
  // Use evaluate() so clicks work even when elements are outside the viewport.
  await page
    .evaluate(() => {
      const dismissSelectors = [
        // "SuperGrok — Try for $0.00" bottom sheet
        'button[class*="dismiss" i], button[aria-label*="dismiss" i]',
        // "Connect your X account — Dismiss" banner
        'button:not([aria-label]):not([type="submit"])',
      ];
      // Find all visible Dismiss-labelled buttons or the SuperGrok close button
      document.querySelectorAll("button").forEach((btn) => {
        const txt = (btn.textContent || "").trim();
        const label = (btn.getAttribute("aria-label") || "").trim();
        if (/^dismiss$/i.test(txt) || /^dismiss$/i.test(label)) btn.click();
      });
      // Also close any visible SuperGrok overlay by pressing Escape equivalent
    })
    .catch(() => {});

  // Brief wait after dismissals, then try pressing Escape to close any overlay
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);

  log(`  ${colors.green("✔")} Clean context established.`);
}
