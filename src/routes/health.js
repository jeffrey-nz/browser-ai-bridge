import express from "express";
import process from "node:process";
import { assertBrowserReady, getBrowserState } from "../browser.js";
import { sessionManager } from "../session/index.js";
import { cooldownManager } from "../session/CooldownManager.js";
import { setupState } from "../setup/state.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import { logger } from "#utils/logger.js";

const router = express.Router();

const ALL_PROVIDER_IDS = Object.keys(PROVIDER_CONFIG);

function buildProvidersPayload(sessions) {
  const byProvider = {};
  for (const id of ALL_PROVIDER_IDS) {
    const cooldown = cooldownManager.check(id);
    byProvider[id] = {
      name: PROVIDER_CONFIG[id].name,
      total: 0,
      active: 0,
      stalled: 0,
      idle: 0,
      cooldown: cooldown.active,
      cooldownSeconds: cooldown.remainingSeconds ?? 0,
    };
  }
  for (const s of sessions) {
    const p = byProvider[s.providerId];
    if (!p) continue;
    p.total++;
    if (s.state === "active") p.active++;
    else if (s.state === "stalled") p.stalled++;
    else p.idle++;
  }
  return byProvider;
}

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
    if (setupState.phase !== "ready") {
      return res.status(503).json({
        status: "initialising",
        setupPhase: setupState.phase,
        browser: getBrowserState(),
      });
    }
    const sessions = sessionManager.listSessions();
    const providers = buildProvidersPayload(sessions);
    res.json({
      status: "ready",
      browser: getBrowserState(),
      uptime: process.uptime(),
      sessions: sessions.length,
      activeSessions: sessions.filter((s) => s.state === "active").length,
      stalledSessions: sessions.filter((s) => s.state === "stalled").length,
      providers,
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
