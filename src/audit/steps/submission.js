import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

export async function stepSubmission(page, locs) {
  // Dismiss any blocking overlay modals (e.g. ChatGPT's Voice NUX modal).
  const modal = page
    .locator(
      '[data-testid*="modal"] button, [data-testid*="nux"] button, button:has-text("Continue")',
    )
    .first();
  if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
    await modal.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }

  const input = page.locator(locs.inputBox).last();

  // textarea.innerText always returns "" regardless of content, so we branch:
  // - native input/textarea: inputValue() reads the real .value property
  // - contenteditable editors: innerText / textContent reflect typed content
  const isContentEditable = await input
    .evaluate((el) => el.isContentEditable)
    .catch(() => false);

  const send = page.locator(locs.sendBtn).last();

  if (isContentEditable) {
    // Prefer clicking the send button; fall back to Enter if it isn't visible
    // (e.g. Grok's send button only appears when the input has focus/content).
    const sendVisible = await send
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (sendVisible) {
      await send.click({ force: true });
    } else {
      await input.focus();
      await input.press("Enter");
    }
  } else {
    // textarea: press Enter on the focused input — fires the real onKeyDown chain
    // that React's submit handler listens on. Button click with force:true
    // bypasses pointer events and doesn't reliably trigger React's onClick.
    await input.focus();
    await input.press("Enter");

    const submitted = await waitForInputClear(input, isContentEditable);
    if (submitted) return true;

    // Fallback: explicit button click if Enter didn't submit
    log(
      colors.yellow(
        "  [WARN] Enter key did not clear input — trying send button click.",
      ),
    );
    const btnVisible = await send
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (btnVisible) {
      await send.click();
    }
  }

  const cleared = await waitForInputClear(input, isContentEditable);
  if (!cleared) {
    log(
      colors.red(
        `  [FAIL] Input still contains text 2.4s after submitting — message was not submitted.`,
      ),
    );
  }
  return cleared;
}

async function waitForInputClear(input, isContentEditable) {
  for (let i = 0; i < 8; i++) {
    await input.page().waitForTimeout(300);
    let text = "";
    if (isContentEditable) {
      text =
        (await input.innerText({ timeout: 300 }).catch(() => "")) ||
        (await input.textContent({ timeout: 300 }).catch(() => ""));
    } else {
      text = await input.inputValue({ timeout: 300 }).catch(() => "");
    }
    if (!text || text.trim().length === 0) return true;
  }
  return false;
}
