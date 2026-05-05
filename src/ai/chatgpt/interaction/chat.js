import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

const TOO_MANY_REQUESTS_SEL = 'p:has-text("You\'re making requests too quickly")';

export async function startNewChat(page) {
  log(`\n🧼 Starting a new chat context...`);

  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Detect ChatGPT's "Too many requests" throttle modal — fail fast so the
  // caller (cycle mode) can skip to the next provider immediately rather than
  // waiting through the full 240s timeout.
  if (await page.locator(TOO_MANY_REQUESTS_SEL).isVisible({ timeout: 500 }).catch(() => false)) {
    const err = new Error("ChatGPT — Too many requests (temporary throttle)");
    err.stalled = true;
    throw err;
  }

  log(`  ${colors.green("✔")} Clean context established.`);
}
