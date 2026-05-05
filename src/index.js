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

  // Kill stale processes first so the port is free before we start the server.
  await killBrowserProcess();
  await killZombieProcess();

  // Start the HTTP server early — before browser connect and login sequence —
  // so that /api/setup is reachable while setup is in progress. The VS Code
  // extension polls this endpoint to drive provider confirmations from the UI.
  let port = Number(process.env.PORT);
  if (isNaN(port)) port = 3333;
  else if (port <= 0) throw new Error("PORT must be a positive integer");
  const server = await startServer(port);
  const boundPort = server.address().port;
  writePidFile();
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
    removePidFile();
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
