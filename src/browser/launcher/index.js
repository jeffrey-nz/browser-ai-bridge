// --- FILE START ---
// Relative Path: src/browser/launcher/index.js
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { logger } from "#utils/logger.js";

import { killBrowserProcess } from "./killer.js";
import { cleanupUserDataDir } from "./cleanup.js";
import { getChromeArgs } from "./args.js";
import { findChromeExecutable } from "./pathFinder.js";
import { internalState } from "../state.js";

export { killBrowserProcess };

export async function autoLaunchChrome() {
  const port = Number(process.env.CDP_PORT ?? 9222);
  const userDataDir = path.join(
    os.tmpdir(),
    process.env.CHROME_TMP ?? "chrome_ai_debug",
  );

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

    // WSL2 can take 20+ seconds for Chrome to bind the CDP port.
    // 10s head-start covers most cold starts before the retry loop kicks in.
    logger.info("[Browser] Waiting for Chrome to bind CDP port...");
    await new Promise((r) => setTimeout(r, 10000));
  } catch (err) {
    logger.error(`[Browser] Auto-launch failed: ${err.message}`);
    throw err;
  }
}
