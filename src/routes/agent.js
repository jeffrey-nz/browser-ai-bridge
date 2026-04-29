import express from "express";
import crypto from "node:crypto";
import { resolveSession, cleanupAutoSession } from "./ask/sessionHandler.js";
import { validateRequest } from "./ask/validation.js";
import { AgentOrchestrator } from "../agent/Orchestrator.js";
import { defaultRegistry } from "../agent/ToolRegistry.js";
import { withSessionLock } from "./ask/withSessionLock.js";
import { sendSuccess, sendError } from "../middleware/respond.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { sessionId, provider, prompt, maxTurns = 15 } = req.body;
  const requestId = crypto.randomUUID();

  const v = validateRequest(req, sessionId, provider);
  if (!v.valid) {
    if (v.retryAfter) res.set("Retry-After", String(v.retryAfter));
    return sendError(
      res,
      v.status,
      v.error,
      { retryAfter: v.retryAfter },
      requestId,
    );
  }

  const { session, autoCreated, error, status } = await resolveSession(
    sessionId,
    provider,
  );
  if (error) {
    if (autoCreated && session) await cleanupAutoSession(true, session);
    return sendError(res, status, error, {}, requestId);
  }

  return withSessionLock(session, autoCreated, async () => {
    try {
      await session.page.bringToFront();

      const orchestrator = new AgentOrchestrator(session, defaultRegistry);
      const result = await orchestrator.runTask(prompt, maxTurns);

      return sendSuccess(res, result, requestId);
    } catch (err) {
      return sendError(res, 500, err.message, {}, requestId);
    }
  });
});

export default router;
