import express from "express";
import { sessionManager } from "../session/index.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import {
  resolveStall,
  isStalled,
  sendActiveControl,
  getSessionState,
} from "../stalls.js";
import { logger } from "#utils/logger.js";
import { capturePageContext } from "../heal/index.js";
import { sendSuccess, sendError } from "../middleware/respond.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json(sessionManager.listSessions());
});

// Session creation timeout: respond before the client's own AbortSignal fires.
// BaseProvider.initialize() can take up to 90s (30s + 60s Playwright retry) when
// the provider site is slow. copilot-helper times out at 15s. Without a server-side
// deadline, the HTTP connection hangs and every subsequent session request queues
// behind the still-loading browser tab, causing a cascade of client timeouts.
//
// Strategy: race createSession against a 30s deadline.
// Cold-boot sessions (pool empty) can take 15-20s on slow connections or when
// the provider page needs a fresh navigation - 12s was too tight for that case.
// If the deadline wins, return 503 immediately and close the session if it eventually
// resolves so we don't leak a browser tab.
const ROUTE_CREATE_TIMEOUT_MS = 30_000;

router.post("/", async (req, res, next) => {
  const { provider } = req.body;

  if (!provider || !PROVIDER_CONFIG[provider]) {
    return sendError(res, 400, `Unknown or missing provider: ${provider}`);
  }

  try {
    const { mode } = req.body;

    let timedOut = false;
    const sessionPromise = sessionManager.createSession(provider, mode);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `Session creation timed out after ${ROUTE_CREATE_TIMEOUT_MS / 1000}s - '${provider}' did not respond in time`,
          ),
        );
      }, ROUTE_CREATE_TIMEOUT_MS),
    );

    let sessionId;
    try {
      sessionId = await Promise.race([sessionPromise, timeoutPromise]);
    } catch (raceErr) {
      if (timedOut) {
        // Clean up the tab if it eventually finishes loading
        sessionPromise
          .then((id) => sessionManager.closeSession(id))
          .catch(() => {});
        return sendError(res, 503, raceErr.message);
      }
      throw raceErr;
    }

     const maxPromptChars = PROVIDER_CONFIG[provider].maxPromptChars;
 logger.info(`[Sessions] Created session ${sessionId} for provider ${provider} with mode ${mode || "default"}`);
 return sendSuccess(res, { sessionId, maxPromptChars });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const ok = await sessionManager.closeSession(req.params.id);
    return res.status(ok ? 200 : 404).json({ success: ok });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/control", async (req, res) => {
  const { id } = req.params;
  const { action, text } = req.body;
  const state = getSessionState(id);

  logger.info(
    `[Control] action=${action} session=${id.slice(0, 8)} state=${state}`,
  );

  const validActions = ["keep_waiting", "retry", "skip", "manual", "self_heal"];
  if (!validActions.includes(action)) {
    return sendError(res, 400, `Unknown action: ${action}`);
  }
  if (action === "manual" && !text) {
    return sendError(res, 400, "action=manual requires text");
  }

  if (state === "active") {
    sendActiveControl(id, { action, text });
    return sendSuccess(res, { action, phase: "active" });
  }

  if (state === "stalled") {
    resolveStall(id, { action, text });
    return sendSuccess(res, { action, phase: "stalled" });
  }

  const session = sessionManager.getSession?.(id);
  return sendError(res, 404, `Session ${id.slice(0, 8)} is idle (not polling or stalled). No control pending.`, { state, sessionExists: !!session });
});

router.get("/:id/snapshot", async (req, res) => {
  const { id } = req.params;
  const session = sessionManager.getSession?.(id);
  if (!session) {
    return sendError(res, 404, `Session ${id.slice(0, 8)} not found`);
  }

  try {
    const { screenshotBase64, htmlSnippet } = await capturePageContext(
      session.page,
    );
    return sendSuccess(res, {
      sessionId: id,
      providerId: session.providerId,
      state: getSessionState(id),
      timestamp: new Date().toISOString(),
      html: htmlSnippet || "",
      screenshotBase64: screenshotBase64 || null,
    });
  } catch (err) {
    logger.error(
      `[Snapshot] Failed for session ${id.slice(0, 8)}: ${err.message}`,
    );
    return sendError(res, 500, err.message);
  }
});

router.get("/:id/status", (req, res) => {
  const { id } = req.params;
  const session = sessionManager.getSession?.(id);
  const state = getSessionState(id);
  const resp = { sessionExists: !!session, state };
  if (session) {
    resp.lastUsedAt = session.lastUsedAt ?? null;
    if (state === "active") {
      resp.activeSinceMs = Date.now() - (session.lastUsedAt ?? Date.now());
    }
  }
  res.json(resp);
});

export default router;
