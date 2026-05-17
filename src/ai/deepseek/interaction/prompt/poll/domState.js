const RATE_LIMIT_RE =
  /messages?\s+are\s+too\s+frequent|rate\s+limit|too\s+many\s+requests/i;

const REGENERATE_SEL =
  '[aria-label*="Regenerate" i], button:has-text("Regenerate"), .ds-icon-button:has-text("Regenerate")';

// Page-level rate-limit selector — catches toasts, modals, and inline error messages.
// Uses Playwright's CSS + text filter so it doesn't scan the entire page body.
const RATE_LIMIT_PAGE_SEL = [
  '[role="alert"]',
  '[class*="error"]',
  '[class*="toast"]',
  '[class*="notice"]',
  "p",
  "span",
]
  .map(
    (s) =>
      `${s}:text-matches("(messages? are too frequent|rate limit|too many requests)", "i")`,
  )
  .join(", ");

export async function getDeepSeekDomState(
  page,
  cfOverlaySel,
  stopBtnSel,
  responseBlockSel,
) {
  // Use .ds-markdown for count/text — it is AI-response-only (user messages
  // never get this class). The broad responseBlockSel would capture user messages
  // and cause the poll to complete early (treating the sent prompt as a response).
  const [isBlocked, isGenerating, currentCount, regenerateVisible] =
    await Promise.all([
      page
        .locator(cfOverlaySel)
        .isVisible({ timeout: 200 })
        .catch(() => false),
      page
        .locator(stopBtnSel)
        .last()
        .isVisible({ timeout: 200 })
        .catch(() => false),
      page
        .locator(".ds-markdown")
        .count()
        .catch(() => 0),
      page
        .locator(REGENERATE_SEL)
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false),
    ]);

  let currentText = "";

  if (currentCount > 0) {
    currentText = await page
      .locator(".ds-markdown")
      .last()
      .innerText({ timeout: 300 })
      .catch(() => "");
  }

  // Check both the response text and page-level error containers for rate-limit messages.
  const rateLimitInResponse = currentText
    ? RATE_LIMIT_RE.test(currentText)
    : false;
  const rateLimitOnPage = rateLimitInResponse
    ? false // skip redundant page scan if already found in response
    : await page
        .locator(RATE_LIMIT_PAGE_SEL)
        .first()
        .isVisible({ timeout: 600 })
        .catch(() => false);

  const isRateLimited = rateLimitInResponse || rateLimitOnPage;

  return {
    isBlocked,
    isGenerating,
    currentCount,
    currentText,
    regenerateVisible,
    isRateLimited,
  };
}
