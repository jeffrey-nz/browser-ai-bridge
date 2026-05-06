import express from "express";
import crypto from "node:crypto";
import { sessionManager } from "../session/index.js";
import { validateRequest, validatePromptLimit } from "./ask/validation.js";
import { resolveSession, cleanupAutoSession } from "./ask/sessionHandler.js";
import { executeAskTurn } from "./ask/executor/index.js";
import { withSessionLock } from "./ask/withSessionLock.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.post("/", async (req, res, next) => {
  const { sessionId, provider, prompt, label, skipConstraint, mode } = req.body;
  const isReviewerTurn = /reviewer/i.test(label ?? "");
  const pollTimeoutMs = isReviewerTurn ? 3 * 60 * 1000 : 7 * 60 * 1000;
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
    mode,
  );
  if (error) {
    if (autoCreated && session) await cleanupAutoSession(true, session);
    return sendError(res, status, error, {}, requestId);
  }

  const pLimit = validatePromptLimit(session, prompt);
  if (!pLimit.valid) {
    await cleanupAutoSession(autoCreated, session);
    return sendError(
      res,
      pLimit.status,
      pLimit.error,
      { max: pLimit.max },
      requestId,
    );
  }

  // If the HTTP client disconnects before we finish writing the response
  // (e.g. a fetch AbortController fires), force-release the session lock so
  // subsequent turns don't pile up with 409. The background browser-AI turn
  // may still be running — needsReset ensures it cleans up before the next
  // caller uses the session.
  //
  // Use req.on("close") not res.on("close"): res "close" only fires after the
  // server actually tries to write to a broken socket (i.e. after the browser
  // automation finishes), which can be 7+ minutes later. req "close" fires
  // immediately when the client drops the TCP connection.
  req.on("close", () => {
    if (!res.writableEnded && session.locked) {
      logger.warn(
        `[Ask] Client disconnected mid-turn for session ${session.id?.slice(0, 8)} - force-releasing stale lock`,
      );
      session.locked = false;
      session.needsReset = true;
    }
  });

  return withSessionLock(session, autoCreated, async () => {
    try {
      const { response, data, messageCount, selfHealEscape, htmlSnapshot } =
        await executeAskTurn(session, prompt, requestId, label, pollTimeoutMs, {
          skipConstraint: !!skipConstraint,
          mode,
        });

      if (selfHealEscape) {
        return sendSuccess(
          res,
          {
            selfHealEscape: true,
            htmlSnapshot: htmlSnapshot || "",
            response: "",
            data: null,
            messageCount: 0,
          },
          requestId,
        );
      }

      return sendSuccess(res, { response, data, messageCount }, requestId);
    } catch (err) {
      sessionManager.logTranscript(session.id, "SYSTEM_ERROR", err.message, {
        requestId,
      });

      if (err.stalled) {
        return sendError(
          res,
          503,
          "STALLED",
          { stalled: true, rateLimited: !!err.rateLimited },
          requestId,
        );
      }
      return sendError(res, 500, err.message, {}, requestId);
    }
  });
});

export default router;
