/**
 * POST /api/evaluate
 *
 * Navigates to a URL with Playwright and runs arbitrary JavaScript in the
 * page context, returning the result. Lets the agent interact with the DOM,
 * read computed styles, simulate clicks, or query element state without
 * desktop automation.
 *
 * Body: { url: string, script: string, session_id?: string }
 * Response: { result: any, error?: string, logs: [{type, text}] }
 *
 * The script is wrapped in an IIFE so `return` can be used at top level:
 *   script: "return document.title"          → { result: "My App" }
 *   script: "return document.querySelectorAll('button').length" → { result: 3 }
 */

import express from "express";
import { getBrowserContext } from "../browser/index.js";
import { checkUrlSafety } from "#utils/urlSecurity.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { url, script, session_id } = req.body ?? {};

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required body parameter: url");
  }
  if (!script || typeof script !== "string") {
    return sendError(res, 400, "Missing required body parameter: script");
  }
  if (script.length > 50_000) {
    return sendError(res, 400, "Script too large (max 50 KB)");
  }

  const safety = checkUrlSafety(url);
  if (safety) return sendError(res, 400, safety);

  let page = null;
  try {
    const { context } = await getBrowserContext();
    page = await context.newPage();

    const consoleLogs = [];
    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text().slice(0, 300) });
    });
    page.on("pageerror", (err) => {
      consoleLogs.push({ type: "pageerror", text: err.message.slice(0, 300) });
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800); // let React/Vue render

    let result = null;
    let error = null;
    try {
      // Wrap the script so `return` works at top level
      const wrapped = `(function() { ${script} })()`;
      result = await page.evaluate(wrapped);
      // JSON-serialize so complex objects survive the Playwright boundary
      if (
        result !== null &&
        result !== undefined &&
        typeof result === "object"
      ) {
        result = JSON.parse(JSON.stringify(result));
      }
    } catch (evalErr) {
      error = evalErr.message;
    }

    logger.info(
      `[Evaluate] ${url}: ok=${!error} logs=${consoleLogs.length}${session_id ? ` sid=${session_id}` : ""}`,
    );

    return sendSuccess(res, {
      url,
      result: result ?? null,
      error: error ?? null,
      logs: consoleLogs.slice(0, 30),
    });
  } catch (err) {
    logger.warn(`[Evaluate] Failed for ${url}: ${err.message}`);
    return sendError(res, 503, `Script evaluation failed: ${err.message}`);
  } finally {
    page?.close().catch(() => {});
  }
});

export default router;
