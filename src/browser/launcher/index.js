// --- FILE START ---
// Relative Path: src/browser/launcher/index.js
import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { logger } from "#utils/logger.js";

import { killBrowserProcess, shouldKillOwnChromeOnShutdown } from "./killer.js";
import { cleanupUserDataDir } from "./cleanup.js";
import { getChromeArgs } from "./args.js";
import { findChromeExecutable } from "./pathFinder.js";
import { internalState } from "../state.js";

export { killBrowserProcess, shouldKillOwnChromeOnShutdown };

// Active TCP poll — resolves as soon as Chrome accepts a connection on the
// CDP port. Beats a fixed sleep because bind time varies (cold start, VPN,
// system load, profile size). Returns false on timeout.
async function waitForPortBound(port, host, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const open = await new Promise((resolve) => {
      const sock = net.connect({ port, host });
      const done = (v) => {
        sock.destroy();
        resolve(v);
      };
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
      sock.setTimeout(1000, () => done(false));
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function autoLaunchChrome() {
  const port = Number(process.env.CDP_PORT ?? 9222);
  // Persist the Chrome profile across reboots so AI-provider logins survive.
  // Previously this lived in os.tmpdir(), which macOS purges on restart —
  // forcing a fresh login every time. Now defaults to a stable dir under the
  // home folder; override with CHROME_USER_DATA_DIR (or just the leaf name via
  // CHROME_TMP, kept for backwards compatibility).
  const userDataDir = process.env.CHROME_USER_DATA_DIR
    ? path.resolve(process.env.CHROME_USER_DATA_DIR)
    : path.join(
        os.homedir(),
        ".browser-ai-bridge",
        process.env.CHROME_TMP ?? "chrome-profile",
      );
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch (e) {
    logger.warn(
      `[Browser] Could not create profile dir ${userDataDir}: ${e.message}`,
    );
  }

  // We only kill at the very start of a fresh launch request
  await killBrowserProcess();
  cleanupUserDataDir(userDataDir);

  const command = findChromeExecutable();
  const args = getChromeArgs(port, userDataDir);

  try {
    logger.info(`[Browser] Spawning Chrome with debugging on port ${port}...`);
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      // Important for macOS/Linux to ensure the process persists
      env: { ...process.env },
    });

    internalState.chromePid = child.pid;
    child.unref();

    logger.info("[Browser] Waiting for Chrome to bind CDP port...");
    const bindTimeoutMs = Number(process.env.CDP_BIND_TIMEOUT_MS ?? 60000);
    const bound = await waitForPortBound(port, "127.0.0.1", bindTimeoutMs);
    if (bound) {
      logger.info("[Browser] CDP port is open.");
    } else {
      logger.warn(
        `[Browser] CDP port did not open within ${bindTimeoutMs}ms — proceeding with connect anyway.`,
      );
    }
  } catch (err) {
    logger.error(`[Browser] Auto-launch failed: ${err.message}`);
    throw err;
  }
}
