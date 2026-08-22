import { logger } from "#utils/logger.js";

async function capturePageContext(page) {
  let screenshotBase64 = null;
  try {
    const buf = await page.screenshot({ type: "png", scale: "css" });
    screenshotBase64 = buf.toString("base64");
  } catch (e) {
    logger.warn(`[SelfHeal] Screenshot failed: ${e.message}`);
  }

  let htmlSnippet = "";
  try {
    const chatSelectors = [
      "#chat-container",
      "main",
      ".ds-chat-container",
      '[class*="chat"]',
      '[class*="conversation"]',
      "body",
    ];
    for (const sel of chatSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        const html = await el.innerHTML({ timeout: 2000 }).catch(() => "");
        if (html.length > 500) {
          htmlSnippet = html.slice(0, 12000);
          break;
        }
      }
    }
    if (!htmlSnippet) {
      htmlSnippet = (await page.content()).slice(0, 12000);
    }
  } catch (e) {
    logger.warn(`[SelfHeal] HTML capture failed: ${e.message}`);
  }

  return { screenshotBase64, htmlSnippet };
}

export { capturePageContext };
