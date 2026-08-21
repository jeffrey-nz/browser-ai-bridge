/**
 * POST /api/audio-ask
 *
 * Uploads an EXISTING audio clip (provided by the caller as a local file path
 * or a base64 data string) to an AI provider session and asks a question
 * about it.
 *
 * The companion to /api/image-ask: where image-ask lets the AI *see* an
 * artefact, audio-ask lets the AI *hear* one — e.g. a synth render of a
 * transcribed score, so the model can catch wrong notes / rhythm by ear.
 *
 * Body: { audioPath?, audioBase64?, prompt, provider?, sessionId?, label? }
 *   - Provide exactly one of audioPath (a path on this machine) or audioBase64
 *     (raw base64, optionally with a "data:audio/wav;base64," prefix).
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

const router = Router();

// Map a data-URI mime type to a sensible file extension. Gemini keys file
// handling off the extension, so a wrong one can make the upload silently fail.
const MIME_EXT = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
};

router.post("/", async (req, res) => {
  const {
    sessionId,
    provider,
    audioPath,
    audioBase64,
    prompt,
    label = "audio-analysis",
    mode = null,
  } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return sendError(res, 400, "Missing prompt");
  }
  if (!audioPath && !audioBase64) {
    return sendError(res, 400, "Provide audioPath or audioBase64");
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

  // Decide the file to upload. For audioPath we use it directly (no temp file);
  // for audioBase64 we decode to a temp file with an extension matching the
  // declared mime type (defaulting to .wav).
  let uploadPath = audioPath;
  let tempPath = null;
  if (!uploadPath) {
    let b64 = audioBase64;
    let ext = ".wav";
    if (b64.startsWith("data:")) {
      const mime = b64.slice(5, b64.indexOf(";")).toLowerCase();
      ext = MIME_EXT[mime] || ".wav";
    }
    const comma = b64.indexOf(",");
    if (b64.startsWith("data:") && comma !== -1) b64 = b64.slice(comma + 1);
    tempPath = join(tmpdir(), `audio-ask-${randomUUID()}${ext}`);
    try {
      await writeFile(tempPath, Buffer.from(b64, "base64"));
    } catch (err) {
      return sendError(res, 500, `Failed to write temp audio: ${err.message}`);
    }
    uploadPath = tempPath;
  } else {
    try {
      await access(uploadPath);
    } catch {
      return sendError(res, 400, `audioPath not found: ${uploadPath}`);
    }
  }

  return withSessionLock(session, false, async () => {
    try {
      // /api/audio-ask is a stateless one-shot. Start a clean chat first so
      // conversation history never accumulates on a reused session — a bloated
      // chat makes the model re-process every past turn and slows (then times
      // out) each later call.
      if (typeof session.engine?.startNewChat === "function") {
        await session.engine
          .startNewChat()
          .catch((e) =>
            logger.warn(`[AudioAsk] startNewChat failed: ${e.message}`),
          );
      }
      // Honour a requested model/mode (e.g. "fast" → Gemini Flash) so audio
      // validation isn't left on a slow "Pro"/"Thinking" model.
      if (mode && typeof session.engine?.setMode === "function") {
        await session.engine
          .setMode(mode)
          .catch((e) =>
            logger.warn(`[AudioAsk] setMode ${mode} failed: ${e.message}`),
          );
      }
      logger.info(
        `[AudioAsk] Uploading ${uploadPath} to ${session.providerId} session (mode: ${mode || "default"})`,
      );
      const result = await session.engine.sendPromptWithFile(
        prompt,
        label,
        session.id,
        uploadPath,
      );
      const payload = { response: result?.text ?? "" };
      // sendPromptWithFile's confirmation is media-agnostic (it checks for
      // ANY attachment evidence, not specifically an image) — surfaced here
      // as audioAttached so the field name doesn't lie about what was sent.
      if (result && result.imageAttached !== undefined) {
        payload.audioAttached = result.imageAttached;
        if (!result.imageAttached) {
          payload.warning =
            "The audio file could not be confirmed as attached to the provider's composer — this response may not reflect the audio at all.";
        }
      }
      return sendSuccess(res, payload);
    } catch (err) {
      logger.warn(`[AudioAsk] sendPromptWithFile failed: ${err.message}`);
      return sendError(res, 500, `Audio ask failed: ${err.message}`);
    } finally {
      if (tempPath) unlink(tempPath).catch(() => {});
      if (autoCreated) {
        await sessionManager.closeSession(session.id).catch(() => {});
      }
    }
  });
});

export default router;
