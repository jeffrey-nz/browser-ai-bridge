/**
 * Screenshot & session monitoring routes.
 *
 * GET  /api/screenshot?url=<url>         Capture any URL in a fresh page.
 * GET  /api/screenshot/session/:id       Capture the live page of a session.
 * GET  /api/screenshot/sessions          Capture all active sessions.
 * GET  /api/screenshot/monitor           Change-detection report across all sessions.
 * POST /api/screenshot/baseline/:id      Force re-baseline a session.
 */

import crypto from "node:crypto";
import express from "express";
import { getBrowserContext } from "../browser/index.js";
import { sessionManager } from "../session/index.js";
import { checkUrlSafety } from "#utils/urlSecurity.js";
import { calculateDomFingerprint } from "../ai/shared/domFingerprint.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

// sessionId → { fingerprint, bufHash, bufLength, timestamp }
const _baselines = new Map();

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function visualDriftPct(prevLength, currLength) {
  if (!prevLength) return 100;
  return Math.round((Math.abs(currLength - prevLength) / prevLength) * 100);
}

async function captureSession(session) {
  if (!session.page || session.page.isClosed()) {
    throw new Error("Session page is closed");
  }
  const buf = await session.page.screenshot({
    type: "png",
    fullPage: false,
    scale: "css",
  });
  const fingerprint = await calculateDomFingerprint(session.page);
  return { buf, fingerprint };
}

// ─── GET /api/screenshot?url=<url> ───────────────────────────────────────────
// Existing: open a fresh page, navigate, screenshot, close.

router.get("/", async (req, res) => {
  const {
    url,
    width = "1280",
    height = "900",
    fullPage = "false",
    delay = "0",
    darkMode = "false",
  } = req.query;

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "Missing required query parameter: url");
  }

  const safety = checkUrlSafety(url);
  if (safety) return sendError(res, 400, safety);

  const vpWidth = Math.min(Math.max(parseInt(width, 10) || 1280, 320), 3840);
  const vpHeight = Math.min(Math.max(parseInt(height, 10) || 900, 200), 2160);
  const isFullPage = fullPage === "true";
  const delayMs = Math.min(Math.max(parseInt(delay, 10) || 0, 0), 10_000);
  const isDark = darkMode === "true";

  let page = null;
  try {
    const { context } = await getBrowserContext();
    page = await context.newPage();
    page.on("console", () => {});
    page.on("pageerror", () => {});

    await page.setViewportSize({ width: vpWidth, height: vpHeight });
    if (isDark) await page.emulateMedia({ colorScheme: "dark" });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800 + delayMs);

    const [buf, title] = await Promise.all([
      page.screenshot({ type: "png", fullPage: isFullPage, scale: "css" }),
      page.title().catch(() => ""),
    ]);

    logger.info(
      `[Screenshot] ${url} ${vpWidth}×${vpHeight}${isFullPage ? " full" : ""}${isDark ? " dark" : ""} (${buf.length} bytes)`,
    );

    return sendSuccess(res, {
      url,
      title,
      screenshotBase64: buf.toString("base64"),
      viewport: { width: vpWidth, height: vpHeight },
      fullPage: isFullPage,
      darkMode: isDark,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(`[Screenshot] Failed for ${url}: ${err.message}`);
    return sendError(res, 500, `Screenshot failed: ${err.message}`);
  } finally {
    if (page) page.close().catch(() => {});
  }
});

// ─── GET /api/screenshot/session/:id ─────────────────────────────────────────
// Screenshot the live page of a specific session without navigating away.

router.get("/session/:id", async (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    return sendError(res, 404, `Session not found: ${req.params.id}`);
  }

  try {
    const { buf, fingerprint } = await captureSession(session);
    logger.info(
      `[Screenshot] Session ${session.id.slice(0, 8)} (${session.providerId}) ${buf.length} bytes`,
    );

    return sendSuccess(res, {
      sessionId: session.id,
      providerId: session.providerId,
      screenshotBase64: buf.toString("base64"),
      fingerprint,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(`[Screenshot] Session ${req.params.id} failed: ${err.message}`);
    return sendError(res, 500, `Screenshot failed: ${err.message}`);
  }
});

// ─── GET /api/screenshot/sessions ────────────────────────────────────────────
// Screenshot all active sessions in one call.

router.get("/sessions", async (req, res) => {
  const list = sessionManager.listSessions();
  const results = [];

  for (const { id } of list) {
    const session = sessionManager.getSession(id);
    if (!session) continue;

    try {
      const { buf, fingerprint } = await captureSession(session);
      results.push({
        sessionId: id,
        providerId: session.providerId,
        screenshotBase64: buf.toString("base64"),
        fingerprint,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      results.push({
        sessionId: id,
        providerId: session.providerId,
        error: err.message,
      });
    }
  }

  return sendSuccess(res, { sessions: results, count: results.length });
});

// ─── GET /api/screenshot/monitor ─────────────────────────────────────────────
// Auto-baselines each session on first call; subsequent calls diff against the
// stored baseline and report what changed. Baselines update when a change is detected.

router.get("/monitor", async (req, res) => {
  const list = sessionManager.listSessions();
  const report = [];

  for (const { id, providerId } of list) {
    const session = sessionManager.getSession(id);
    if (!session) continue;

    try {
      const { buf, fingerprint } = await captureSession(session);
      const bufHash = hashBuffer(buf);
      const baseline = _baselines.get(id);

      if (!baseline) {
        _baselines.set(id, {
          fingerprint,
          bufHash,
          bufLength: buf.length,
          timestamp: Date.now(),
        });
        logger.info(
          `[Monitor] Baselined session ${id.slice(0, 8)} (${providerId})`,
        );
        report.push({
          sessionId: id,
          providerId,
          status: "baselined",
          fingerprint,
          screenshotBase64: buf.toString("base64"),
          timestamp: new Date().toISOString(),
        });
      } else {
        const fingerprintChanged = baseline.fingerprint !== fingerprint;
        const visualChanged = baseline.bufHash !== bufHash;
        const changed = fingerprintChanged || visualChanged;

        if (changed) {
          _baselines.set(id, {
            fingerprint,
            bufHash,
            bufLength: buf.length,
            timestamp: Date.now(),
          });
          logger.info(
            `[Monitor] Change detected on ${id.slice(0, 8)} (${providerId}): ` +
              `fingerprint=${fingerprintChanged} visual=${visualChanged}`,
          );
        }

        report.push({
          sessionId: id,
          providerId,
          status: changed ? "changed" : "stable",
          changed,
          fingerprintChanged,
          visualChanged,
          visualDriftPct: visualDriftPct(baseline.bufLength, buf.length),
          fingerprint: { previous: baseline.fingerprint, current: fingerprint },
          baselinedAt: new Date(baseline.timestamp).toISOString(),
          screenshotBase64: buf.toString("base64"),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.warn(`[Monitor] Session ${id.slice(0, 8)} error: ${err.message}`);
      report.push({ sessionId: id, providerId, error: err.message });
    }
  }

  const changedCount = report.filter((r) => r.status === "changed").length;
  return sendSuccess(res, {
    report,
    changed: changedCount,
    total: report.length,
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /api/screenshot/baseline/:id ───────────────────────────────────────
// Force-reset the baseline for a session (e.g. after a deliberate UI action).

router.post("/baseline/:id", async (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    return sendError(res, 404, `Session not found: ${req.params.id}`);
  }

  try {
    const { buf, fingerprint } = await captureSession(session);
    const bufHash = hashBuffer(buf);
    _baselines.set(req.params.id, {
      fingerprint,
      bufHash,
      bufLength: buf.length,
      timestamp: Date.now(),
    });
    logger.info(
      `[Monitor] Re-baselined session ${req.params.id.slice(0, 8)} (${session.providerId})`,
    );

    return sendSuccess(res, {
      sessionId: req.params.id,
      providerId: session.providerId,
      fingerprint,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      `[Monitor] Baseline failed for ${req.params.id}: ${err.message}`,
    );
    return sendError(res, 500, `Baseline failed: ${err.message}`);
  }
});

export default router;
