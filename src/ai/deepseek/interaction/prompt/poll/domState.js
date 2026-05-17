const RATE_LIMIT_RE =
  /messages?\s+are\s+too\s+frequent|rate\s+limit|too\s+many\s+requests/i;

const BUSY_GENERATING_RE =
  /a message is being generated[,.]?\s*please try again later/i;

const REGENERATE_SEL =
  '[aria-label*="Regenerate" i], button:has-text("Regenerate"), .ds-icon-button:has-text("Regenerate")';

const PAGE_ERROR_SELS = [
  '[role="alert"]',
  '[class*="error"]',
  '[class*="toast"]',
  '[class*="notice"]',
  "p",
  "span",
];

// Page-level rate-limit selector — catches toasts, modals, and inline error messages.
const RATE_LIMIT_PAGE_SEL = PAGE_ERROR_SELS.map(
  (s) =>
    `${s}:text-matches("(messages? are too frequent|rate limit|too many requests)", "i")`,
).join(", ");

// Page-level busy selector — catches "A message is being generated" toasts.
const BUSY_GENERATING_PAGE_SEL = PAGE_ERROR_SELS.map(
  (s) => `${s}:text-matches("a message is being generated", "i")`,
).join(", ");

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

  // Check both response text and page-level containers for rate-limit and busy messages.
  const rateLimitInResponse = currentText ? RATE_LIMIT_RE.test(currentText) : false;
  const busyInResponse = currentText ? BUSY_GENERATING_RE.test(currentText) : false;

  const rateLimitOnPage = rateLimitInResponse
    ? false
    : await page
        .locator(RATE_LIMIT_PAGE_SEL)
        .first()
        .isVisible({ timeout: 600 })
        .catch(() => false);

  const busyOnPage = busyInResponse
    ? false
    : await page
        .locator(BUSY_GENERATING_PAGE_SEL)
        .first()
        .isVisible({ timeout: 600 })
        .catch(() => false);

  const isRateLimited = rateLimitInResponse || rateLimitOnPage;
  const isBusyGenerating = busyInResponse || busyOnPage;

  return {
    isBlocked,
    isGenerating,
    currentCount,
    currentText,
    regenerateVisible,
    isRateLimited,
    isBusyGenerating,
  };
}
