/**
 * POST /api/image-ask
 *
 * Uploads an EXISTING image (provided by the caller as a local file path or a
 * base64 data string) to an AI provider session and asks a question about it.
 *
 * Unlike /api/visual-ask — which screenshots a live URL first — this endpoint
 * takes an image the caller already has (e.g. a rendered sheet-music PNG) and
 * sends it straight to the AI for visual analysis.
 *
 * Body: { imagePath?, imageBase64?, prompt, provider?, sessionId?, label? }
 *   - Provide exactly one of imagePath (a path on this machine) or imageBase64
 *     (raw base64, optionally with a "data:image/png;base64," prefix).
 * Response: { success, response }
 *
 * Errors: 400 (bad params), 404 (session not found), 501 (provider has no file
 *         upload), 500 (write/upload failure).
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { writeFile, unlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionManager } from "../session/index.js";
import { withSessionLock } from "./ask/withSessionLock.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";
import { describeUploadFailure } from "#ai/shared/uploadOutcome.js";

const router = Router();

router.post("/", async (req, res) => {
  const {
    sessionId,
    provider,
    imagePath,
    imageBase64,
    prompt,
    label = "image-analysis",
    mode = null,
  } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return sendError(res, 400, "Missing prompt");
  }
  if (!imagePath && !imageBase64) {
    return sendError(res, 400, "Provide imagePath or imageBase64");
  }

  // Resolve the session — explicit id, then a free existing one, otherwise
  // create one on demand (the connection pool is lazy, so often none exist).
  const allSessions = sessionManager.listSessions();
  let session;
  let autoCreated = false;
  if (sessionId) {
    session = sessionManager.getSession(sessionId);
    if (!session) return sendError(res, 404, "Session expired or invalid");
  } else {
    const found = allSessions.find(
      (s) =>
        (!provider || s.providerId === provider) &&
        s.state !== "busy" &&
        !s.locked,
    );
    if (found) {
      session = sessionManager.getSession(found.id);
    } else {
      try {
        const newId = await sessionManager.createSession(provider);
        session = sessionManager.getSession(newId);
        autoCreated = true;
      } catch (err) {
        return sendError(res, 500, `Failed to create session: ${err.message}`);
      }
    }
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

  // Decide the file to upload. For imagePath we use it directly (no temp file);
  // for imageBase64 we decode to a temp PNG.
  let uploadPath = imagePath;
  let tempPath = null;
  if (!uploadPath) {
    let b64 = imageBase64;
    const comma = b64.indexOf(",");
    if (b64.startsWith("data:") && comma !== -1) b64 = b64.slice(comma + 1);
    tempPath = join(tmpdir(), `image-ask-${randomUUID()}.png`);
    try {
      await writeFile(tempPath, Buffer.from(b64, "base64"));
    } catch (err) {
      return sendError(res, 500, `Failed to write temp image: ${err.message}`);
    }
    uploadPath = tempPath;
  } else {
    try {
      await access(uploadPath);
    } catch {
      return sendError(res, 400, `imagePath not found: ${uploadPath}`);
    }
  }

  return withSessionLock(session, false, async () => {
    try {
      // /api/image-ask is a stateless one-shot. Start a clean chat first so
      // conversation history never accumulates on a reused session — a bloated
      // chat makes the model re-process every past turn and slows (then times
      // out) each later call.
      if (typeof session.engine?.startNewChat === "function") {
        await session.engine
          .startNewChat()
          .catch((e) =>
            logger.warn(`[ImageAsk] startNewChat failed: ${e.message}`),
          );
      }
      // Honour a requested model/mode (e.g. "fast" → Gemini Flash). Without
      // this the visual transcription runs on whatever model the tab was last
      // left on — a slow "Pro"/"Thinking" model makes every bar crawl.
      if (mode && typeof session.engine?.setMode === "function") {
        await session.engine
          .setMode(mode)
          .catch((e) =>
            logger.warn(`[ImageAsk] setMode ${mode} failed: ${e.message}`),
          );
      }
      logger.info(
        `[ImageAsk] Uploading ${uploadPath} to ${session.providerId} session (mode: ${mode || "default"})`,
      );
      const result = await session.engine.sendPromptWithFile(
        prompt,
        label,
        session.id,
        uploadPath,
      );
      const payload = { response: result?.text ?? "" };
      // Mirror /api/ask's honesty contract: the caller has no other way to
      // tell a read image from an ignored one (T-001 on the crew board).
      if (result && result.imageAttached !== undefined) {
        payload.imageAttached = result.imageAttached;
        if (!result.imageAttached) {
          payload.imageAttachedCause = result.imageAttachedCause;
          payload.warning = describeUploadFailure(result.imageAttachedCause);
        }
      }
      return sendSuccess(res, payload);
    } catch (err) {
      logger.warn(`[ImageAsk] sendPromptWithFile failed: ${err.message}`);
      return sendError(res, 500, `Image ask failed: ${err.message}`);
    } finally {
      if (tempPath) unlink(tempPath).catch(() => {});
      if (autoCreated) {
        await sessionManager.closeSession(session.id).catch(() => {});
      }
    }
  });
});

export default router;
