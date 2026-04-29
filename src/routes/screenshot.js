/**
 * GET /api/screenshot?url=<url>
 *
 * Opens a fresh Playwright page, navigates to the requested URL, takes a
 * full-page PNG screenshot, then closes the page.  Returns the image as a
 * base64 string so callers don't need access to the filesystem.
 *
 * The page is opened in the existing browser context (same Chrome instance
 * that already handles AI sessions) so no extra browser process is needed.
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

  // Basic URL validation — must be http/https
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

    // Suppress console noise from the target page
    page.on("console", () => {});
    page.on("pageerror", () => {});

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Brief settle — let CSS/fonts render
    await page.waitForTimeout(800);

    const buf = await page.screenshot({
      type: "png",
      fullPage: false,
      scale: "css",
    });
    const screenshotBase64 = buf.toString("base64");

    logger.info(`[Screenshot] Captured ${url} (${buf.length} bytes)`);

    return sendSuccess(res, {
      url,
      screenshotBase64,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(`[Screenshot] Failed for ${url}: ${err.message}`);
    return sendError(res, 500, `Screenshot failed: ${err.message}`);
  } finally {
    if (page) {
      page.close().catch(() => {});
    }
  }
});

export default router;
