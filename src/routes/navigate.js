/**
 * POST /api/navigate { url }
 *
 * Brings the active browser page to the foreground and navigates to the given URL.
 * Returns immediately — does not wait for the page to fully load. This lets callers
 * send the user to an external site (e.g. an AI image generator) while keeping the
 * existing browser session alive.
 */

import express from "express";
import { getBrowserContext } from "../browser/index.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required body parameter: url");
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return sendError(res, 400, "Only http/https URLs are supported");
    }
  } catch {
    return sendError(res, 400, `Invalid URL: ${url}`);
  }

  try {
    const { context } = await getBrowserContext();
    const pages = context.pages();

    // Prefer an existing non-blank page so we don't accumulate orphan tabs
    let page = pages.find((p) => p.url() !== "about:blank") ?? pages[0];
    if (!page) page = await context.newPage();

    await page.bringToFront();

    // Fire-and-forget — caller doesn't need to wait for full navigation
    page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => {});

    logger.info(`[Navigate] Browser directed to ${url}`);
    return sendSuccess(res, { url });
  } catch (err) {
    logger.warn(`[Navigate] Failed: ${err.message}`);
    return sendError(res, 500, `Navigate failed: ${err.message}`);
  }
});

export default router;
