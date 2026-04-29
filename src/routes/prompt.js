/**
 * POST /api/prompt { sessionId?, provider, prompt }
 *
 * Injects a prompt into the AI browser session and returns immediately —
 * without waiting for the AI response. The user can continue the conversation
 * manually in the browser.
 */

import express from "express";
import { resolveSession, cleanupAutoSession } from "./ask/sessionHandler.js";
import { validateRequest } from "./ask/validation.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { sessionId, provider, prompt } = req.body;

  const v = validateRequest(req, sessionId, provider);
  if (!v.valid) {
    if (v.retryAfter) res.set("Retry-After", String(v.retryAfter));
    return sendError(res, v.status, v.error);
  }

  const { session, autoCreated, error, status } = await resolveSession(
    sessionId,
    provider,
  );
  if (error) {
    if (autoCreated && session) await cleanupAutoSession(true, session);
    return sendError(res, status, error);
  }

  try {
    await session.page.bringToFront();
    await session.engine.sendPromptOnly(prompt);
    logger.info(
      `[Prompt] Sent to session ${session.id.slice(0, 8)} (${session.providerId})`,
    );
    return sendSuccess(res, { sent: true, sessionId: session.id });
  } catch (err) {
    logger.warn(
      `[Prompt] Failed for session ${session.id.slice(0, 8)}: ${err.message}`,
    );
    await cleanupAutoSession(autoCreated, session);
    return sendError(res, 500, err.message);
  }
});

export default router;
