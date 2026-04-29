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
import { PROVIDER_CONFIG } from "./config/providers.js";
import { logger } from "#utils/logger.js";

const HOTKEY_HINT = "\x1b[2m  [R] Re-run provider setup  [Q] Quit\x1b[0m";

function printHotkeyHint() {
  if (process.stdout.isTTY) process.stdout.write(`\n${HOTKEY_HINT}\n`);
}

function resetProviders() {
  for (const cfg of Object.values(PROVIDER_CONFIG)) {
    cfg.disabled = false;
  }
}

async function init() {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║     AI Browser Automation API          ║");
  console.log("╚════════════════════════════════════════╝");

  // Kill any stale Chrome and stale API process BEFORE launching a new browser.
  // Previously killZombieProcess() ran after initializePool(), creating a race:
  // pool warmup would start sessions on the new Chrome, then the zombie kill
  // would SIGTERM the old API process whose shutdown handler ran
  // `pkill -9 chrome`, killing the new Chrome mid-warmup.
  await killBrowserProcess();
  await killZombieProcess();
  const { context } = await connectToBrowser();

  await runLoginSequence(context);

  await sessionPool.initializePool();

  let port = Number(process.env.PORT);
  if (isNaN(port)) port = 3333;
  else if (port <= 0) throw new Error("PORT must be a positive integer");
  const server = await startServer(port);
  const boundPort = server.address().port;
  writePidFile();
  writeApiConfig(boundPort);

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
      await runLoginSequence(context);
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
    process.stdin.setRawMode(true);
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

  // SIGTERM is sent by a new API instance's killZombieProcess() when it starts
  // up and finds a stale PID file. The new instance has already called
  // killBrowserProcess() before spawning its own Chrome, so Chrome is either
  // already dead or belongs to the new process - killing it here would crash
  // the new instance's sessions. Exit cleanly without touching Chrome.
  process.on("SIGTERM", () => {
    logger.info("[Shutdown] SIGTERM received, exiting without killing Chrome");
    process.exit(0);
  });
}

export { init };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  init();
}
