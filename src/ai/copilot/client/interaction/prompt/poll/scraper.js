export async function scrapeProgressText(page) {
  return await page
    .evaluate(() => {
      const msgs = Array.from(
        document.querySelectorAll('div[id^="chatMessageResponse-"]'),
      );
      const m365Msgs = Array.from(
        document.querySelectorAll('[data-content="ai-message"]'),
      );
      const list = msgs.length ? msgs : m365Msgs;
      if (!list.length) return null;

      const active = list[list.length - 1];

      const progress =
        active.querySelector('[data-message-type="Progress"]') ||
        active.querySelector('span[data-message-type="Progress"]') ||
        active.querySelector(".ac-textBlock p");

      if (progress && progress.innerText) {
        const t = progress.innerText.trim();
        if (t && t.length < 120) return t;
      }

      const status =
        document.querySelector('[role="status"]') ||
        document.querySelector('[aria-live="polite"]');

      const s = status?.innerText?.trim();
      if (s && s.length < 120) return s;

      return null;
    })
    .catch(() => null);
}
