/**
 * POST /api/visual-ask
 *
 * Screenshots a running web app URL, uploads the screenshot to the AI provider
 * session's chat window via Playwright browser automation, then asks the AI to
 * analyze the screenshot and return a structured QA report.
 *
 * No external AI APIs are used — analysis is performed entirely through the
 * existing browser session (same automation used for all pipeline prompts).
 *
 * Body: { sessionId, provider, screenshotUrl, prompt, label? }
 * Response: { response: string }
 *
 * Errors: 400 (bad params), 404 (session not found), 503 (session locked/busy),
 *         500 (screenshot or upload failure)
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBrowserContext } from "../browser/index.js";
import { sessionManager } from "../session/index.js";
import { withSessionLock } from "./ask/withSessionLock.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = Router();

const DEFAULT_VISUAL_PROMPT = `You are a QA engineer reviewing a screenshot of a React web app built by an AI coding agent.

Respond with JSON ONLY (no prose, no markdown fences):
{
  "pass": boolean,
  "issues": string[],
  "feedback": string
}

- pass: true if the app renders and shows the primary UI (no blank page, no error overlays)
- issues: list of specific visual problems found (empty array if pass)
- feedback: one-sentence developer-facing summary

Check for:
1. Blank/white/all-black page (= broken)
2. Primary UI element missing (board, form, calculator) (= broken)
3. Visible JS error overlay or React error boundary (= broken)
4. For board/chess games: alternating square colors required; pieces must be visually distinct
5. Obviously broken layout (invisible text, collapsed elements, unstyled raw HTML)`;

router.post("/", async (req, res) => {
  const {
    sessionId,
    provider,
    screenshotUrl,
    prompt = DEFAULT_VISUAL_PROMPT,
    label = "visual-qa",
  } = req.body;

  if (!screenshotUrl) return sendError(res, 400, "Missing screenshotUrl");
  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(screenshotUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return sendError(res, 400, "Only http/https URLs are supported");
    }
  } catch {
    return sendError(res, 400, `Invalid screenshotUrl: ${screenshotUrl}`);
  }

  // Find the session — prefer explicit sessionId, then provider match, then any available.
  // Always resolve to the full session object (which includes engine) via getSession().
  const allSessions = sessionManager.listSessions();
  let session;
  if (sessionId) {
    session = sessionManager.getSession(sessionId);
  } else if (provider) {
    const found = allSessions.find(
      (s) => s.providerId === provider && s.state !== "busy",
    );
    if (found) session = sessionManager.getSession(found.id);
  } else {
    const found = allSessions.find((s) => s.state !== "busy");
    if (found) session = sessionManager.getSession(found.id);
  }
  if (!session) {
    return sendError(
      res,
      404,
      `No available session (provider: ${provider || "any"})`,
    );
  }

  if (!session.engine?.sendPromptWithFile) {
    return sendError(
      res,
      501,
      `Provider '${session.providerId}' does not support file upload`,
    );
  }

  const tempPath = join(tmpdir(), `visual-ask-${randomUUID()}.png`);

  return withSessionLock(session, false, async () => {
    // 1. Take screenshot using a fresh Playwright page (separate from AI session tab)
    let screenshotBuf;
    try {
      const { context } = await getBrowserContext();
      const page = await context.newPage();
      try {
        page.on("console", () => {});
        page.on("pageerror", () => {});
        await page.goto(screenshotUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(1000);
        screenshotBuf = await page.screenshot({
          type: "png",
          fullPage: false,
          scale: "css",
        });
      } finally {
        page.close().catch(() => {});
      }
    } catch (err) {
      logger.warn(
        `[VisualAsk] Screenshot failed for ${screenshotUrl}: ${err.message}`,
      );
      return sendError(res, 503, `Screenshot failed: ${err.message}`);
    }

    // 2. Save screenshot to temp file
    try {
      await writeFile(tempPath, screenshotBuf);
    } catch (err) {
      return sendError(
        res,
        500,
        `Failed to write temp screenshot: ${err.message}`,
      );
    }

    // 3. Upload screenshot + send prompt via browser automation
    try {
      logger.info(
        `[VisualAsk] Uploading ${screenshotUrl} screenshot to ${session.providerId} session`,
      );
      const result = await session.engine.sendPromptWithFile(
        prompt,
        label,
        session.id,
        tempPath,
      );

      const response = result?.text ?? "";
      return sendSuccess(res, { response, screenshotUrl });
    } catch (err) {
      logger.warn(`[VisualAsk] sendPromptWithFile failed: ${err.message}`);
      return sendError(res, 500, `Visual ask failed: ${err.message}`);
    } finally {
      unlink(tempPath).catch(() => {});
    }
  });
});

export default router;
