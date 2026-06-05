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
// Strategy: race createSession against a 90s deadline.
// Cold-boot sessions (pool empty) can take 15-20s on slow connections; Gemini
// navigation can take 60-80s when the page is slow or shows interstitial prompts.
// 30s was too tight for Gemini cold starts. 90s covers the full Playwright retry
// window (30s + 60s) without exceeding the client's own 120s HTTP timeout.
// If the deadline wins, return 503 immediately and close the session if it eventually
// resolves so we don't leak a browser tab.
const ROUTE_CREATE_TIMEOUT_MS = 90_000;

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
    logger.info(
      `[Sessions] Created session ${sessionId} for provider ${provider} with mode ${mode || "default"}`,
    );
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
  return sendError(
    res,
    404,
    `Session ${id.slice(0, 8)} is idle (not polling or stalled). No control pending.`,
    { state, sessionExists: !!session },
  );
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

// Evaluate arbitrary JS in a session's page context — useful for DOM inspection
// and automated selector discovery. Returns { result } or { error }.
router.post("/:id/evaluate", async (req, res) => {
  const { id } = req.params;
  const { script } = req.body ?? {};
  const session = sessionManager.getSession?.(id);
  if (!session?.page) return sendError(res, 404, `Session not found: ${id}`);
  if (!script) return sendError(res, 400, "Missing body parameter: script");
  try {
    const wrapped = `(function(){${script}})()`;
    const result = await session.page.evaluate(wrapped);
    return sendSuccess(res, { result });
  } catch (err) {
    return sendError(res, 500, `Evaluate failed: ${err.message}`);
  }
});

// Trigger startNewChat on a session (resets the conversation context)
router.post("/:id/new-chat", async (req, res) => {
  const { id } = req.params;
  const session = sessionManager.getSession?.(id);
  if (!session?.engine) return sendError(res, 404, `Session not found: ${id}`);
  try {
    await session.engine.startNewChat();
    return sendSuccess(res, { ok: true });
  } catch (err) {
    return sendError(res, 500, `new-chat failed: ${err.message}`);
  }
});

// Extract the AI-generated image from a session's page and return it as base64.
// Reads the image data *inside* the page context (so blob: URLs and same-origin
// images work), skipping UI chrome (sparkles, avatars, spinners). Optional query
// param ?minSize=512 sets the minimum width/height to accept (default 512) — lets
// the caller poll until the real generated image (not a placeholder) has rendered.
// Used by the icon generator to auto-grab images without a manual right-click-save.
router.get("/:id/extract-image", async (req, res) => {
  const { id } = req.params;
  const session = sessionManager.getSession?.(id);
  if (!session?.page) return sendError(res, 404, `Session not found: ${id}`);

  const minSize = Math.max(0, parseInt(req.query.minSize, 10) || 512);

  try {
    const result = await session.page.evaluate(async (minSize) => {
      // UI chrome to ignore: Gemini sparkle, Google avatars, SVG icons, gifs.
      const isJunk = (src) =>
        !src ||
        /gstatic\.com/i.test(src) ||
        /googleusercontent\.com\/a[/_]/i.test(src) || // profile avatars
        /\.svg(\?|$)/i.test(src) ||
        src.startsWith("data:image/gif");

      const candidates = Array.from(document.querySelectorAll("img")).filter(
        (el) => {
          const src = el.currentSrc || el.src || "";
          return (
            src &&
            !isJunk(src) &&
            el.naturalWidth >= minSize &&
            el.naturalHeight >= minSize
          );
        },
      );

      if (candidates.length === 0) return { found: false };

      // Prefer images explicitly marked as AI-generated, then largest.
      candidates.sort((a, b) => {
        const aAI = /ai[\s-]?generated/i.test(a.alt || "") ? 1 : 0;
        const bAI = /ai[\s-]?generated/i.test(b.alt || "") ? 1 : 0;
        if (aAI !== bAI) return bAI - aAI;
        return (
          b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight
        );
      });

      const best = candidates[0];
      const meta = {
        width: best.naturalWidth,
        height: best.naturalHeight,
        alt: best.alt || "",
        src: (best.currentSrc || best.src || "").slice(0, 60),
      };

      // Method 1 — canvas. Reads the already-decoded image with no network
      // request, so it works for blob: URLs that CSP blocks fetch() on.
      // Throws if the canvas is tainted (cross-origin without CORS).
      try {
        const canvas = document.createElement("canvas");
        canvas.width = best.naturalWidth;
        canvas.height = best.naturalHeight;
        canvas.getContext("2d").drawImage(best, 0, 0);
        return { found: true, dataUrl: canvas.toDataURL("image/png"), method: "canvas", ...meta };
      } catch (canvasErr) {
        // Method 2 — fetch the URL (handles tainted-canvas cases on same-origin).
        try {
          const resp = await fetch(best.currentSrc || best.src);
          const blob = await resp.blob();
          const dataUrl = await new Promise((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
          });
          return { found: true, dataUrl, method: "fetch", ...meta };
        } catch (fetchErr) {
          return {
            found: true,
            dataUrl: null,
            error: `canvas: ${canvasErr.message} | fetch: ${fetchErr.message}`,
            ...meta,
          };
        }
      }
    }, minSize);

    if (!result?.found) {
      return sendError(res, 404, `No generated image (>= ${minSize}px) found on page`);
    }
    if (!result.dataUrl) {
      return sendError(res, 500, `Found ${result.width}x${result.height} image but failed to read it: ${result.error || "unknown"}`);
    }

    const [header, data] = result.dataUrl.split(",");
    const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";

    return sendSuccess(res, {
      imageBase64: data,
      mimeType,
      width: result.width,
      height: result.height,
      alt: result.alt,
      source: result.src,
      method: result.method,
    });
  } catch (err) {
    return sendError(res, 500, `Image extraction failed: ${err.message}`);
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
