export async function applySpaceHack(page, inputBoxLocator) {
  if (!inputBoxLocator) return;
  await inputBoxLocator.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
}

export async function triggerFallbackSubmit(
  page,
  inputBoxLocator,
  attempt,
  ctrlEnterFallback,
) {
  if (inputBoxLocator) await inputBoxLocator.focus();

  if (attempt > 1 && inputBoxLocator) {
    await page.keyboard.press("Space");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(150);
  }

  if (ctrlEnterFallback && attempt > 1) {
    await page.keyboard.press("Control+Enter");
  } else {
    await page.keyboard.press("Enter");
  }
}
