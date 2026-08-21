import express from "express";
import process from "node:process";
import { assertBrowserReady, getBrowserState } from "../browser.js";
import { sessionManager } from "../session/index.js";
import { cooldownManager } from "../session/CooldownManager.js";
import { setupState } from "../setup/state.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import { getDevServerCount } from "./devserver.js";
import { logger } from "#utils/logger.js";
import { isLongRunning, LONG_RUNNING_THRESHOLD_MS } from "../stalls.js";

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
      // T-003: renamed from `stalled` — this counts a turn PAUSED AWAITING
      // AN OPERATOR'S DECISION (registerStall, stalls.js), which only ever
      // happens on the interactive/TTY path (stallLoop.js). A caller with
      // no operator attached — every HTTP/API caller — can never make this
      // non-zero; see `longRunningSessions` on the top-level response for
      // the number that actually answers "is anything stuck" for them.
      awaitingOperator: 0,
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
    else if (s.state === "stalled") p.awaitingOperator++;
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
    const mem = process.memoryUsage();
    res.json({
      status: "ready",
      browser: getBrowserState(),
      uptime: process.uptime(),
      sessions: sessions.length,
      activeSessions: sessions.filter((s) => s.state === "active").length,
      // T-003: renamed from `stalledSessions`. This is a session PAUSED
      // AWAITING AN OPERATOR — it can only be non-zero when a human is
      // attached (a TTY session), because registerStall (stalls.js) is only
      // ever called from that path. For an unattended/API caller this field
      // is 0 by construction, always — that is not a health signal, it is
      // this field's structural range. See `longRunningSessions` below for
      // the number an unattended caller can actually act on.
      awaitingOperatorSessions: sessions.filter((s) => s.state === "stalled")
        .length,
      // A session mid-turn for longer than LONG_RUNNING_THRESHOLD_MS
      // (measured against this board's own recorded turn-time corpus — see
      // stalls.js) — works for any caller, operator or none, because it is
      // purely elapsed time on the existing active-session tracking.
      longRunningSessions: sessions.filter((s) => isLongRunning(s.id)).length,
      longRunningThresholdMs: LONG_RUNNING_THRESHOLD_MS,
      // T-003: "the process is up" (uptime) is not "the browser is usable".
      // A browser collapse that leaves the CDP connection itself intact —
      // every page/context closed underneath it — showed uptime climbing
      // and status "ready" the whole time. attachedPages reads each
      // registered session's OWN page.isClosed() directly (bypassing the
      // self-pruning getSession() does on access), so it reflects reality
      // even for sessions nothing has tried to use since they died.
      attachedPages: sessions.filter((s) => s.pageAttached).length,
      devServers: getDevServerCount(),
      providers,
      mem: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
      },
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
