import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { ensureLocator } from "../../ensureLocator.js";
import { dismissGroundingMenus, dismissSidePane } from "../../sidepane.js";
import { COPILOT_365_LOCATORS } from "../../../locators.js";

// Selectors for overlays that can absorb button clicks
const BLOCKING_OVERLAY_SELECTOR = [
  COPILOT_365_LOCATORS.pageSidePane,
  COPILOT_365_LOCATORS.designerImageFrame,
].join(", ");

const SEND_BTN_SELECTOR = [
  'button[title="Submit"]',
  'button[title="Send"]',
  'button[aria-label="Submit"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send"]',
  '[data-testid="send-button"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="Submit" i]',
  '[data-testid*="send" i]',
  '[data-testid*="submit" i]',
  '[data-testid="composer-content"] button:not([id="composer-create-button"]):not([data-testid="composer-chat-mode-smart-button"]):not([data-testid="audio-call-button"])',
].join(", ");

async function waitForSendButton(page, maxMs = 6000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const btn = page.locator(SEND_BTN_SELECTOR).last();
    if (await btn.isVisible({ timeout: 350 }).catch(() => false)) return btn;
    await page.waitForTimeout(250);
  }
  return null;
}

async function waitUntilEnabled(btn, maxMs = 2500) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const disabled = await btn.isDisabled().catch(() => false);
    if (!disabled) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export async function clickSubmit(page, textArea) {
  await dismissGroundingMenus(page);

  // If a Pages sidepane or Designer iframe is open it can overlay the composer
  // and absorb clicks that should go to the send button. Dismiss it before
  // we try to find and click the button.
  const overlayVisible = await page
    .locator(BLOCKING_OVERLAY_SELECTOR)
    .first()
    .isVisible({ timeout: 400 })
    .catch(() => false);
  if (overlayVisible) {
    log(
      colors.yellow(
        `  [Submit] Overlay detected before send — dismissing before click...`,
      ),
    );
    await dismissSidePane(page);
  }

  let submitBtn = await waitForSendButton(page, 6000);

  if (!submitBtn) {
    log(
      colors.yellow(
        `  [Submit] Send button not found — trying Ctrl+Enter fallback...`,
      ),
    );
    await textArea.focus().catch(() => {});
    await page.keyboard.press("Control+Enter").catch(() => {});
    await page.waitForTimeout(1800);

    const postCtrlEnterVal = await textArea
      .evaluate((el) => el.value ?? el.innerText ?? el.textContent ?? "")
      .catch(() => "");

    if (postCtrlEnterVal.trim().length === 0) return true;

    submitBtn = await ensureLocator(
      page,
      "submit_btn",
      "the send/submit button",
      () => page.locator(SEND_BTN_SELECTOR).last(),
    );
  }

  const enabled = await waitUntilEnabled(submitBtn, 2500);

  if (!enabled) {
    await textArea.focus().catch(() => {});
    await page.keyboard.press("Space").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.waitForTimeout(400);
  }

  await submitBtn.click({ delay: 80 }).catch(async () => {
    await textArea.press("Enter").catch(() => {});
  });

  await page.waitForTimeout(1800);

  const postSubmitVal = await textArea
    .evaluate((el) => el.value ?? el.innerText ?? "")
    .catch(() => "");

  if (postSubmitVal.trim().length > 0) {
    const stopBtn = page
      .locator(
        'button[aria-label*="Stop"], button[title*="Stop"], [data-testid="stop-button"]',
      )
      .last();

    const accepted =
      (await stopBtn.isVisible().catch(() => false)) ||
      (await textArea.isDisabled().catch(() => false));

    if (accepted) return true;

    await page.waitForTimeout(900);
    return false;
  }

  return true;
}
