import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

// Matches several known ChatGPT rate-limit message variants.
// IMPORTANT: ChatGPT renders curly apostrophes (U+2019) in the rate-limit
// message — "You're making requests too quickly. We've temporarily limited..."
// has-text in Playwright is a substring match, so use the shortest unambiguous
// fragment that side-steps both apostrophe variants entirely.
export const TOO_MANY_REQUESTS_SEL = [
  'p:has-text("making requests too quickly")',
  'div:has-text("making requests too quickly")',
  'p:has-text("temporarily limited access")',
  'div:has-text("temporarily limited access")',
  'p:has-text("Too many requests")',
  'div:has-text("too many requests")',
  '[data-testid="rate-limit-modal"]',
].join(", ");

export async function isTooManyRequests(page, timeoutMs = 3000) {
  return page
    .locator(TOO_MANY_REQUESTS_SEL)
    .first()
    .isVisible({ timeout: timeoutMs })
    .catch(() => false);
}

export async function startNewChat(page) {
  // If the tab is already sitting on the ChatGPT root (no conversation path),
  // it's already a blank slate — skip the navigation to avoid creating a new
  // sidebar conversation entry every time a session is acquired.
  const url = page.url();
  const isAlreadyFresh =
    url === "https://chatgpt.com/" ||
    url === "https://chatgpt.com" ||
    url.startsWith("https://chatgpt.com/?");

  if (!isAlreadyFresh) {
    log(`\n🧼 Starting a new chat context...`);
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  // Detect ChatGPT's "Too many requests" throttle — fail fast so the caller
  // (cycle mode) skips to the next provider instead of waiting 240s.
  // Setting err.rateLimited surfaces the throttle through the route layer so
  // the reader-app's ProviderCooldown can mark this provider as unavailable
  // for several minutes — otherwise we'd retry it on every batch and hit the
  // throttle screen again.
  if (await isTooManyRequests(page, 3000)) {
    const err = new Error("ChatGPT — Too many requests (temporary throttle)");
    err.stalled = true;
    err.rateLimited = true;
    throw err;
  }

  if (isAlreadyFresh) {
    log(`  ${colors.green("✔")} Already on fresh context — reusing tab.`);
  } else {
    log(`  ${colors.green("✔")} Clean context established.`);
  }
}
