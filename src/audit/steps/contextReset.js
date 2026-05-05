export async function stepContextReset(page, locs) {
  if (!locs.newChatBtn) return true;

  // Try each matched element — isVisible() doesn't check viewport position,
  // so wrap each click in try/catch to skip off-screen elements.
  const btns = page.locator(locs.newChatBtn);
  const count = await btns.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const btn = btns.nth(i);
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      try {
        await btn.click({ force: true });
        await page.waitForTimeout(1000);
        return true;
      } catch {
        // Off-screen or otherwise unclickable — try the next match
      }
    }
  }

  // No visible new-chat button — the tab was just opened at the provider URL
  // so we are already in a fresh context. Return true rather than blocking.
  return true;
}
