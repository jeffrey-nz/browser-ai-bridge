import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "#utils/logger.js";

// T-060: this used to be one fixed filename shared by every instance,
// regardless of port — so a spare-port instance started for a one-off
// probe/test (a documented, deliberate pattern: see vision-probe.mjs's
// `--break` doc comment) would read the LIVE instance's pid out of this
// file and SIGTERM it, even though the two never shared a port or a CDP
// port. Measured live in T-052: a bridge running on 3333 was killed by a
// second instance started with PORT=3334 and its own CDP_PORT. Scoping the
// filename by port makes "stale instance ON THE PORT I AM ABOUT TO BIND"
// the only thing this file can ever mean.
function pidFilePath(port) {
  return join(tmpdir(), `browser-ai-bridge-${port}.pid`);
}

export const API_CONFIG_PATH = join(tmpdir(), "browser-ai-bridge-config.json");

// Legacy alias read by copilot-helper/launcher.js and agent-core/bridgeClient.js
const API_CONFIG_PATH_LEGACY = join(tmpdir(), "automation-api-config.json");

export function writeApiConfig(port) {
  const payload = JSON.stringify({ port });
  for (const file of [API_CONFIG_PATH, API_CONFIG_PATH_LEGACY]) {
    try {
      writeFileSync(file, payload, "utf8");
    } catch (e) {
      logger.error(e, `[Config] Could not write config file ${file}`);
    }
  }
  logger.info(`[Config] Bound port ${port} written to config files`);
}

export function writePidFile(port) {
  try {
    writeFileSync(pidFilePath(port), String(process.pid), "utf8");
  } catch (e) {
    logger.warn(`[PID] Could not write pid file: ${e.message}`);
  }
}

// T-060: only ever removes THIS port's pid file — the shared config
// files are a separate, deliberately global "where's the bridge"
// discovery pointer (read by copilot-helper/launcher.js and
// agent-core/bridgeClient.js) and clearing them on any instance's
// shutdown is existing, correct behaviour, not part of this ticket.
export function removePidFile(port) {
  [pidFilePath(port), API_CONFIG_PATH, API_CONFIG_PATH_LEGACY].forEach(
    (file) => {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
          logger.info(`[Cleanup] Removed temporary file: ${file}`);
        }
      } catch (e) {
        // Safe cleanup: ignore errors if files are already gone or inaccessible
      }
    },
  );
}

export async function killZombieProcess(port) {
  const pidFile = pidFilePath(port);
  if (!existsSync(pidFile)) return;

  let pid;
  try {
    pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  } catch {
    removePidFile(port);
    return;
  }

  if (!pid || pid === process.pid) {
    removePidFile(port);
    return;
  }

  // Check if the process is actually alive
  try {
    process.kill(pid, 0);
  } catch {
    // Process is already gone
    removePidFile(port);
    return;
  }

  logger.warn(
    `[Startup] Stale instance detected on port ${port} (PID ${pid}) - sending SIGTERM...`,
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

  removePidFile(port);
  logger.info(
    `[Startup] Stale instance on port ${port} cleared. Starting fresh.`,
  );
}
