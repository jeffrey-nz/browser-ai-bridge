/**
 * POST /api/click
 *
 * Navigates to a URL, waits for a CSS selector to appear, clicks it, then
 * returns the resulting DOM state so the agent can see the effect.
 *
 * Body: { url, selector, wait_after_ms?, session_id? }
 * Response: { clicked, resultHtml, consoleErrors, error? }
 *
 * Useful for:
 *   - Clicking tabs / nav items and verifying the correct content loads
 *   - Submitting forms and checking the success/error state
 *   - Toggling UI elements (modals, dropdowns, accordions)
 */

import express from "express";
import { getBrowserContext } from "../browser/index.js";
import { checkUrlSafety } from "#utils/urlSecurity.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { url, selector, wait_after_ms = 800, session_id } = req.body ?? {};

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required body parameter: url");
  }
  if (!selector || typeof selector !== "string") {
    return sendError(res, 400, "Missing required body parameter: selector");
  }

  const safety = checkUrlSafety(url);
  if (safety) return sendError(res, 400, safety);

  const waitMs = Math.min(Math.max(Number(wait_after_ms) || 800, 0), 10_000);

  let page = null;
  try {
    const { context } = await getBrowserContext();
    page = await context.newPage();

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) =>
      consoleErrors.push(err.message.slice(0, 300)),
    );

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1000); // let React/Vue render

    // Wait for the target element to appear
    try {
      await page.waitForSelector(selector, { timeout: 8000, state: "visible" });
    } catch {
      const rootHtml = await page.evaluate(() => {
        const el =
          document.getElementById("root") || document.getElementById("app");
        return el
          ? el.innerHTML.slice(0, 800)
          : document.body.innerHTML.slice(0, 800);
      });
      return sendError(res, 404, `Selector "${selector}" not found within 8s`, {
        rootHtml,
        consoleErrors: consoleErrors.slice(0, 5),
      });
    }

    // Click the element
    await page.click(selector);

    // Wait for any resulting navigation/re-render
    if (waitMs > 0) await page.waitForTimeout(waitMs);

    // Capture DOM state after click
    const resultHtml = await page.evaluate(() => {
      const el =
        document.getElementById("root") || document.getElementById("app");
      return el
        ? el.innerHTML.slice(0, 2000)
        : document.body.innerHTML.slice(0, 2000);
    });

    const errorOverlay = await page.evaluate(() => {
      const v = document.querySelector(
        "vite-error-overlay, [class*='error-overlay']",
      );
      return v
        ? (v.shadowRoot?.textContent || v.textContent || "").slice(0, 300)
        : null;
    });

    logger.info(
      `[Click] ${url} selector="${selector}" ok errors=${consoleErrors.length}${session_id ? ` sid=${session_id}` : ""}`,
    );

    return sendSuccess(res, {
      url,
      selector,
      clicked: true,
      resultHtml,
      errorOverlay: errorOverlay ?? null,
      consoleErrors: consoleErrors.slice(0, 5),
    });
  } catch (err) {
    logger.warn(`[Click] Failed for ${url}: ${err.message}`);
    return sendError(res, 503, `Click failed: ${err.message}`);
  } finally {
    page?.close().catch(() => {});
  }
});

export default router;
