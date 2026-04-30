import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "#utils/logger.js";

const PID_FILE = join(tmpdir(), "browser-ai-bridge.pid");

// Config file lives in the OS temp directory so copilot-helper can read it
// without knowing the automation-api project root path.
export const API_CONFIG_PATH = join(tmpdir(), "browser-ai-bridge-config.json");

export function writeApiConfig(port) {
  try {
    writeFileSync(API_CONFIG_PATH, JSON.stringify({ port }), "utf8");
    logger.info(`[Config] Bound port ${port} written to ${API_CONFIG_PATH}`);
  } catch (e) {
    logger.error(e, `[Config] Could not write config file`);
  }
}

export function writePidFile() {
  try {
    writeFileSync(PID_FILE, String(process.pid), "utf8");
  } catch (e) {
    logger.warn(`[PID] Could not write pid file: ${e.message}`);
  }
}

export function removePidFile() {
  [PID_FILE, API_CONFIG_PATH].forEach((file) => {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
        logger.info(`[Cleanup] Removed temporary file: ${file}`);
      }
    } catch (e) {
      // Safe cleanup: ignore errors if files are already gone or inaccessible
    }
  });
}

export async function killZombieProcess() {
  if (!existsSync(PID_FILE)) return;

  let pid;
  try {
    pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
  } catch {
    removePidFile();
    return;
  }

  if (!pid || pid === process.pid) {
    removePidFile();
    return;
  }

  // Check if the process is actually alive
  try {
    process.kill(pid, 0);
  } catch {
    // Process is already gone
    removePidFile();
    return;
  }

  logger.warn(
    `[Startup] Stale instance detected (PID ${pid}) - sending SIGTERM...`,
  );
  try {
    process.kill(pid, "SIGTERM");
  } catch {}

  // Give it 2s to exit cleanly
  await new Promise((r) => setTimeout(r, 2000));

  // If still alive, force kill
  try {
    process.kill(pid, 0);
    logger.warn(`[Startup] PID ${pid} did not exit - sending SIGKILL...`);
    process.kill(pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // Already dead
  }

  removePidFile();
  logger.info(`[Startup] Stale instance cleared. Starting fresh on base port.`);
}
