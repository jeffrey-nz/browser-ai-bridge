export async function checkForCopilotError(page) {
  try {
    const errorEl = page
      .locator('[id^="chatMessageResponse"] span, .text-danger, [role="alert"]')
      .last();
    const visible = await errorEl
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (!visible) return false;

    const text = await errorEl.innerText({ timeout: 500 }).catch(() => "");
    return text.trim().includes("Something went wrong");
  } catch {
    return false;
  }
}
