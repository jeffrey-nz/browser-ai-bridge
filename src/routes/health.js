import express from "express";
import process from "node:process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertBrowserReady, getBrowserState } from "../browser.js";
import { sessionManager } from "../session/index.js";
import { cooldownManager } from "../session/CooldownManager.js";
import { setupState } from "../setup/state.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import { getDevServerCount } from "./devserver.js";
import { logger } from "#utils/logger.js";
import { isLongRunning, LONG_RUNNING_THRESHOLD_MS } from "../stalls.js";
import { getLastUnexpectedPageCloseAt } from "../session/collapseDetector.js";

const router = express.Router();

const ALL_PROVIDER_IDS = Object.keys(PROVIDER_CONFIG);

// T-049: what commit this PROCESS actually loaded, not what HEAD says right
// now. Node does not hot-reload — every module this server imported was
// read from disk once, at startup, and stays in memory unchanged until the
// process restarts, however far HEAD moves after that. Read exactly once,
// at module load (this file is imported once per process lifetime), and
// cached in this module-level constant — a per-request `git rev-parse` would
// just re-answer "what does HEAD say right now" and reproduce the exact bug
// this field exists to catch (T-042/T-045 both verified live against a
// bridge that had silently drifted commits behind the fix under test).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOADED_COMMIT = (() => {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    // Not fatal — a caller running this outside a git checkout still gets a
    // working health endpoint, just without a commit to compare against.
    return null;
  }
})();

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
      loadedCommit: LOADED_COMMIT,
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
      // T-023: attachedPages is only informative while a dead session is
      // still in the registry — a window bounded by the GC sweep or the next
      // getSession() touch. Once that session is gone, attachedPages reads
      // the same 0 a healthy idle bridge reads. This is the sticky half:
      // the timestamp of the last time this process discovered a registered
      // session's page closed WITHOUT this process asking for that close
      // (collapseDetector.js), surviving the registry drain that erases
      // attachedPages's evidence. Reset to null only when a brand-new
      // session finishes initializing — confirmed proof the browser can
      // still produce a live page. No added cost: both values it reads are
      // already computed synchronously elsewhere; this endpoint makes no new
      // await against the browser.
      lastUnexpectedPageCloseAt: (() => {
        const ms = getLastUnexpectedPageCloseAt();
        return ms === null ? null : new Date(ms).toISOString();
      })(),
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
