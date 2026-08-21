import process from "node:process";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { connectToBrowser, killBrowserProcess } from "./browser.js";
import { startServer } from "./server.js";
import { runLoginSequence } from "./startup/authSequence.js";
import {
  killZombieProcess,
  writePidFile,
  removePidFile,
  writeApiConfig,
} from "./startup/pidManager.js";
import { sessionManager } from "./session/index.js";
import { sessionPool } from "./session/Pool.js";
import { setupState } from "./setup/state.js";
import { PROVIDER_CONFIG } from "./config/providers.js";
import { logger } from "#utils/logger.js";

const HOTKEY_HINT = "\x1b[2m  [R] Re-run provider setup  [Q] Quit\x1b[0m";

function printHotkeyHint() {
  if (process.stdout.isTTY) process.stdout.write(`\n${HOTKEY_HINT}\n`);
}

function applyProviderFilter() {
  const envList = process.env.BROWSER_AI_PROVIDERS;
  if (!envList) return;
  const enabled = new Set(
    envList.split(",").map((s) => s.trim().toLowerCase()),
  );
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIG)) {
    cfg.disabled = !enabled.has(id);
  }
}

function resetProviders() {
  for (const cfg of Object.values(PROVIDER_CONFIG)) {
    cfg.disabled = false;
  }
  applyProviderFilter();
}

async function init() {
  // Register early so SIGTERM during Chrome startup is logged, not silent.
  // The comment below explains the legitimate source of this signal.
  process.on("SIGTERM", () => {
    logger.info("[Shutdown] SIGTERM received, exiting without killing Chrome");
    process.exit(0);
  });

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║     AI Browser Automation API          ║");
  console.log("╚════════════════════════════════════════╝");

  applyProviderFilter();

  // T-060: resolved before the kill-stale calls below, not after — the pid
  // file killZombieProcess() checks is scoped BY this port (see
  // pidManager.js), so it has to be known before that call, not just
  // before startServer().
  let port = Number(process.env.PORT);
  if (isNaN(port)) port = 3333;
  else if (port <= 0) throw new Error("PORT must be a positive integer");

  // Kill a stale bridge process first so the HTTP port is free before we
  // start the server.
  //
  // T-064: this used to ALSO call killBrowserProcess() here, unconditionally,
  // before connectToBrowser() ever got a chance to try CDP_URL. That call
  // kills whatever owns CDP_PORT (default 9222) with no tracked PID to
  // check against on a fresh process — so a second bridge, pointed via
  // CDP_URL at a DIFFERENT, perfectly healthy bridge's Chrome, killed it
  // before even attempting to connect, every time the CDP_PORT it resolved
  // to happened to match. Measured live: two "No tracked PID; killing
  // process on CDP port <N>..." log lines per startup — one from here, one
  // from inside autoLaunchChrome() a moment later — the FIRST of which
  // fired before "Server listening" even printed, i.e. before this
  // process had tried CDP_URL at all. connectToBrowser() (below) already
  // tries connectOverCDP() FIRST and only falls through to
  // autoLaunchChrome() — which does its own, later, narrower kill — when
  // that genuinely fails. This call added a second, earlier, unconditional
  // kill with no corresponding attempt to connect first; removed rather
  // than guarded, since nothing here needs it that connectToBrowser()
  // doesn't already do more carefully.
  await killZombieProcess(port);

  // Start the HTTP server early — before browser connect and login sequence —
  // so that /api/setup is reachable while setup is in progress. The VS Code
  // extension polls this endpoint to drive provider confirmations from the UI.
  const server = await startServer(port);
  const boundPort = server.address().port;
  // Written under `port` (not `boundPort`) so a future restart's
  // killZombieProcess(port) — resolved the same way, from the same env var,
  // before it knows what actually got bound — looks in the same place this
  // wrote to.
  writePidFile(port);
  writeApiConfig(boundPort);

  const { context } = await connectToBrowser();

  await runLoginSequence(context);

  // Signal to the extension that all providers are confirmed and the bridge
  // is ready to accept task sessions.
  setupState.setReady();

  await sessionPool.initializePool();

  printHotkeyHint();

  const shutdown = async () => {
    process.stdout.write("\n");
    stopKeys();
    logger.info("[Shutdown] Closing server and active AI sessions...");
    removePidFile(port);
    try {
      await sessionManager.closeAllSessions();
    } catch (e) {
      logger.error(e, "[Shutdown] Error during session cleanup");
    }
    server.close(async () => {
      await killBrowserProcess();
      process.exit(0);
    });
  };

  let restarting = false;

  const handleKey = async (str, key) => {
    if (restarting) return;

    if ((key && key.ctrl && key.name === "c") || str === "q" || str === "Q") {
      await shutdown();
      return;
    }

    if (str === "r" || str === "R") {
      restarting = true;
      process.stdout.write("\n");
      logger.info("[Restart] Closing active sessions before re-setup...");
      try {
        await sessionManager.closeAllSessions();
      } catch (e) {
        logger.error(e, "[Restart] Session cleanup error");
      }

      stopKeys();
      resetProviders();
      setupState.phase = "starting";
      await runLoginSequence(context);
      setupState.setReady();
      sessionPool.initializePool();
      printHotkeyHint();

      startKeys();
      restarting = false;
    }
  };

  let stopKeys;

  function startKeys() {
    if (!process.stdin.isTTY) return;
    readline.emitKeypressEvents(process.stdin);
    try {
      process.stdin.setRawMode(true);
    } catch {
      return;
    }
    process.stdin.resume();
    process.stdin.on("keypress", handleKey);

    stopKeys = () => {
      process.stdin.off("keypress", handleKey);
      try {
        process.stdin.setRawMode(false);
      } catch {}
    };
  }

  stopKeys = () => {};
  startKeys();

  process.on("SIGINT", shutdown);
}

export { init };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  init();
}
