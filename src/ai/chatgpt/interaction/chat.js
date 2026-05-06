import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

// Matches several known ChatGPT rate-limit message variants.
export const TOO_MANY_REQUESTS_SEL = [
  'p:has-text("You\'re making requests too quickly")',
  'p:has-text("You are making requests too quickly")',
  'p:has-text("Too many requests")',
  'div:has-text("too many requests")',
  '[data-testid="rate-limit-modal"]',
].join(", ");

export async function isTooManyRequests(page, timeoutMs = 3000) {
  return page.locator(TOO_MANY_REQUESTS_SEL).first()
    .isVisible({ timeout: timeoutMs })
    .catch(() => false);
}

export async function startNewChat(page) {
  log(`\n🧼 Starting a new chat context...`);

  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Detect ChatGPT's "Too many requests" throttle — fail fast so the caller
  // (cycle mode) skips to the next provider instead of waiting 240s.
  if (await isTooManyRequests(page, 3000)) {
    const err = new Error("ChatGPT — Too many requests (temporary throttle)");
    err.stalled = true;
    throw err;
  }

  log(`  ${colors.green("✔")} Clean context established.`);
}
