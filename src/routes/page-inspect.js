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
import { checkUrlSafety } from "#utils/urlSecurity.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required query parameter: url");
  }

  const safety = checkUrlSafety(url);
  if (safety) return sendError(res, 400, safety);

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
    await page.waitForTimeout(1500); // let React/Vue render

    const inspection = await page.evaluate(() => {
      // ── Page title ────────────────────────────────────────────────────────
      const title = document.title || "";

      // ── Root element ──────────────────────────────────────────────────────
      const root = document.getElementById("root") || document.getElementById("app");
      const rootHtml = root ? root.innerHTML.trim() : "";
      const hasContent = rootHtml.length > 30;

      // ── React mount detection ─────────────────────────────────────────────
      // React 16+ attaches _reactFiber/_reactInternals to the root container.
      const reactMounted = root
        ? Object.keys(root).some(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"))
        : false;

      // ── Error overlay (Vite, React error boundary) ────────────────────────
      let errorOverlay = null;
      const viteOverlay = document.querySelector(
        "vite-error-overlay, [class*='error-overlay'], [id*='error-overlay']",
      );
      if (viteOverlay) {
        errorOverlay = (
          viteOverlay.shadowRoot?.textContent?.slice(0, 500) ||
          viteOverlay.textContent?.slice(0, 500) ||
          ""
        );
      } else {
        const errorEl = document.querySelector(
          "[class*='error-boundary'], [class*='ErrorBoundary'], [data-reactroot] [class*='error']",
        );
        if (errorEl) errorOverlay = errorEl.textContent?.slice(0, 500) || null;
      }

      // ── Import errors from Vite overlay ──────────────────────────────────
      const importErrors = [];
      if (viteOverlay) {
        const msgs = viteOverlay.shadowRoot?.querySelectorAll(".message, .file-link")
          || viteOverlay.querySelectorAll(".message, .file-link");
        msgs?.forEach(el => {
          const t = el.textContent?.trim();
          if (t && /import|module|not found|failed to|resolve/i.test(t)) {
            importErrors.push(t.slice(0, 200));
          }
        });
      }

      // ── DOM snippet (first meaningful child of root) ───────────────────────
      const domSnippet = root
        ? root.outerHTML.slice(0, 600)
        : document.body?.innerHTML?.slice(0, 400) || "";

      return { title, rootHtml, hasContent, reactMounted, errorOverlay, importErrors, domSnippet };
    });

    logger.info(
      `[PageInspect] ${url}: mounted=${inspection.reactMounted} hasContent=${inspection.hasContent}` +
      ` error=${!!inspection.errorOverlay} consoleErrors=${consoleErrors.length}`,
    );

    return sendSuccess(res, {
      url,
      title:         inspection.title,
      reactMounted:  inspection.reactMounted,
      hasContent:    inspection.hasContent,
      errorOverlay:  inspection.errorOverlay,
      importErrors:  inspection.importErrors.slice(0, 5),
      consoleErrors: consoleErrors.slice(0, 10),
      domSnippet:    inspection.domSnippet,
      // Legacy aliases for older callers
      rootHtml:      inspection.rootHtml.slice(0, 2000),
      errorText:     inspection.errorOverlay,
    });
  } catch (err) {
    logger.warn(`[PageInspect] Failed for ${url}: ${err.message}`);
    return sendError(res, 503, `Page inspection failed: ${err.message}`);
  } finally {
    page?.close().catch(() => {});
  }
});

export default router;
