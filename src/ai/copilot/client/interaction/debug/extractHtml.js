export async function extractHtml(page) {
  return await page
    .evaluate(() => {
      const target =
        document.querySelector('[data-testid="composer"]') ||
        document.querySelector("#m365-chat-input-shared-container") ||
        document.querySelector('[data-test-id="chat-input-wrapper"]') ||
        document.querySelector("#m365-copilot-app-layout-main") ||
        document.querySelector("main") ||
        document.body ||
        document.documentElement;

      if (!target) return "No DOM target found.";

      const clone = target.cloneNode(true);
      for (const el of clone.querySelectorAll(
        "script, style, svg, iframe, [data-tabster-dummy], img, path, meta, link",
      )) {
        el.remove();
      }
      return clone.outerHTML || clone.innerHTML;
    })
    .catch((e) => `(Could not capture page HTML: ${e.message})`);
}
