const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 150;

export async function extractViaClipboardAPI(page, copyBtn) {
  if (!(await copyBtn.isVisible().catch(() => false))) {
    return null;
  }

  try {
    await page.bringToFront();

    await page.evaluate(async () => {
      window.focus();
      try {
        await navigator.clipboard.writeText("");
      } catch (e) {}
    });

    await copyBtn.click({ delay: 50, timeout: 3000 });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await page.waitForTimeout(attempt === 1 ? 400 : RETRY_DELAY_MS);

      const clipboardText = await page.evaluate(async () => {
        try {
          return await Promise.race([
            navigator.clipboard.readText(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Clipboard Read Timeout")),
                800,
              ),
            ),
          ]);
        } catch (e) {
          return null;
        }
      });

      if (clipboardText) return clipboardText;
    }

    return null;
  } catch (err) {
    return null;
  }
}
