/**
 * GET /api/page-inspect?url=<url>
 *
 * Navigates to a URL with Playwright, waits for React to render, then returns
 * key DOM content for deterministic visual checks:
 *   - rootHtml: innerHTML of #root (empty string if React didn't mount)
 *   - errorText: visible error overlay text (Vite errors, React error boundaries)
 *   - hasContent: true if #root has meaningful children
 *
 * Used by visualVerify.js to distinguish:
 *   - Import errors (Vite overlay) → skip, not a visual failure
 *   - Blank page with no errors → fail, something is wrong
 *   - Rendered app → pass (or escalate to AI check)
 */

import express from "express";
import { getBrowserContext } from "../browser/index.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required query parameter: url");
  }

  let parsed;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return sendError(res, 400, "Only http/https URLs are supported");
    }
  } catch {
    return sendError(res, 400, `Invalid URL: ${url}`);
  }

  let page = null;
  try {
    const { context } = await getBrowserContext();
    page = await context.newPage();

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1500); // let React render

    // Get #root innerHTML (empty if app didn't mount)
    const rootHtml = await page.evaluate(() => {
      const root = document.getElementById("root") || document.getElementById("app");
      return root ? root.innerHTML.trim() : "";
    });

    // Get visible error overlay text (Vite error overlay, React error boundary)
    const errorText = await page.evaluate(() => {
      const viteOverlay = document.querySelector(
        "vite-error-overlay, [class*='error-overlay'], [id*='error-overlay']"
      );
      if (viteOverlay) return viteOverlay.shadowRoot?.textContent?.slice(0, 500) || viteOverlay.textContent?.slice(0, 500) || "";

      // React error boundary or uncaught error display
      const errorEl = document.querySelector(
        "[class*='error-boundary'], [class*='ErrorBoundary'], [data-reactroot] [class*='error']"
      );
      return errorEl ? errorEl.textContent?.slice(0, 500) || "" : "";
    });

    const hasContent = rootHtml.length > 30; // more than just empty wrapper divs

    logger.info(`[PageInspect] ${url}: hasContent=${hasContent} errorText=${!!errorText} consoleErrors=${consoleErrors.length}`);

    return sendSuccess(res, {
      url,
      hasContent,
      rootHtml: rootHtml.slice(0, 2000),
      errorText: errorText.slice(0, 500),
      consoleErrors: consoleErrors.slice(0, 5),
    });
  } catch (err) {
    logger.warn(`[PageInspect] Failed for ${url}: ${err.message}`);
    return sendError(res, 503, `Page inspection failed: ${err.message}`);
  } finally {
    page?.close().catch(() => {});
  }
});

export default router;
