import { execSync } from "node:child_process";
import process from "node:process";
import { logger } from "#utils/logger.js";
import { internalState } from "../state.js";

export async function killBrowserProcess() {
  const pid = internalState.chromePid;

  if (pid) {
    logger.info(`[Browser] Killing managed Chrome process (PID ${pid})...`);
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      }
    } catch (_) {}
    internalState.chromePid = null;
  } else {
    // No tracked PID — kill only whatever process owns the CDP port.
    const port = Number(process.env.CDP_PORT ?? 9222);
    logger.info(
      `[Browser] No tracked PID; killing process on CDP port ${port}...`,
    );
    try {
      if (process.platform === "win32") {
        const out = execSync(
          `netstat -ano | findstr :${port}`,
          { stdio: "pipe" },
        ).toString();
        const match = out.match(/\s(\d+)\s*$/m);
        if (match) execSync(`taskkill /F /PID ${match[1]} /T`, { stdio: "ignore" });
      } else {
        execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: "ignore" });
      }
    } catch (_) {}
  }

  await new Promise((r) => setTimeout(r, 1000));
}
