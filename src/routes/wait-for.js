/**
 * POST /api/wait-for
 *
 * Navigates to a URL and waits until a CSS selector appears in the DOM,
 * up to timeout_ms (default 10 000 ms). Returns whether the element appeared
 * and its visible text, letting the agent poll for async content.
 *
 * Body: { url, selector, timeout_ms?, state?, session_id? }
 *   state: "visible" (default) | "attached" | "hidden" | "detached"
 * Response: { found, elapsed_ms, text?, error? }
 *
 * Useful for:
 *   - Waiting for a loading spinner to disappear (state: "hidden")
 *   - Waiting for a success toast / confirmation message to appear
 *   - Confirming that a lazy-loaded component eventually renders
 */

import express from "express";
import { getBrowserContext } from "../browser/index.js";
import { checkUrlSafety } from "#utils/urlSecurity.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

const VALID_STATES = new Set(["visible", "attached", "hidden", "detached"]);

router.post("/", async (req, res) => {
  const {
    url,
    selector,
    timeout_ms = 10000,
    state = "visible",
    session_id,
  } = req.body ?? {};

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required body parameter: url");
  }
  if (!selector || typeof selector !== "string") {
    return sendError(res, 400, "Missing required body parameter: selector");
  }
  if (!VALID_STATES.has(state)) {
    return sendError(
      res,
      400,
      `Invalid state "${state}". Must be one of: ${[...VALID_STATES].join(", ")}`,
    );
  }

  const safety = checkUrlSafety(url);
  if (safety) return sendError(res, 400, safety);

  const timeoutMs = Math.min(
    Math.max(Number(timeout_ms) || 10000, 500),
    30_000,
  );

  let page = null;
  const t0 = Date.now();
  try {
    const { context } = await getBrowserContext();
    page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500); // let first render settle

    let found = false;
    let text = null;

    try {
      await page.waitForSelector(selector, { timeout: timeoutMs, state });
      found = true;

      // Grab visible text of the matched element
      text = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el
          ? (el.textContent || el.innerText || "").trim().slice(0, 500)
          : null;
      }, selector);
    } catch {
      // Timed out — found stays false
    }

    const elapsed_ms = Date.now() - t0;

    logger.info(
      `[WaitFor] ${url} selector="${selector}" state=${state} found=${found} elapsed=${elapsed_ms}ms${session_id ? ` sid=${session_id}` : ""}`,
    );

    return sendSuccess(res, {
      url,
      selector,
      state,
      found,
      elapsed_ms,
      text: text ?? null,
    });
  } catch (err) {
    logger.warn(`[WaitFor] Failed for ${url}: ${err.message}`);
    return sendError(res, 503, `Wait-for failed: ${err.message}`);
  } finally {
    page?.close().catch(() => {});
  }
});

export default router;
