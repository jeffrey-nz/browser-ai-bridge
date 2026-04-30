import express from "express";
import process from "node:process";
import { assertBrowserReady, getBrowserState } from "../browser.js";
import { sessionManager } from "../session/index.js";
import { setupState } from "../setup/state.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

router.get("/warmup", async (_req, res) => {
  try {
    const { connectToBrowser } = await import("../browser/connection.js");
    await connectToBrowser();
    res.json({ status: "warmed_up" });
  } catch (e) {
    res.status(503).json({ status: "failed", error: e.message });
  }
});

router.get("/", (_req, res) => {
  try {
    assertBrowserReady();
    // Don't report ready until the login sequence is complete — callers like
    // copilot-helper and reader-app poll this endpoint and proceed only when
    // status === "ready". Returning early would let them start before providers
    // are confirmed.
    if (setupState.phase !== "ready") {
      return res.status(503).json({
        status: "initialising",
        setupPhase: setupState.phase,
        browser: getBrowserState(),
      });
    }
    const sessions = sessionManager.listSessions();
    const byProvider = {};
    for (const s of sessions) {
      if (!byProvider[s.providerId])
        byProvider[s.providerId] = { total: 0, active: 0, stalled: 0 };
      byProvider[s.providerId].total++;
      if (s.state === "active") byProvider[s.providerId].active++;
      else if (s.state === "stalled") byProvider[s.providerId].stalled++;
    }
    res.json({
      status: "ready",
      browser: getBrowserState(),
      uptime: process.uptime(),
      sessions: sessions.length,
      activeSessions: sessions.filter((s) => s.state === "active").length,
      stalledSessions: sessions.filter((s) => s.state === "stalled").length,
      providers: byProvider,
    });
  } catch (e) {
    logger.warn(`Ping failed: ${e.message}`);
    res.status(503).json({
      status: "initialising",
      browser: getBrowserState(),
      error: e.message,
    });
  }
});

export default router;
