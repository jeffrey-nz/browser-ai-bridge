export async function stepContextReset(page, locs) {
  if (!locs.newChatBtn) return true;

  const btn = page.locator(locs.newChatBtn).first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click({ force: true });
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}
