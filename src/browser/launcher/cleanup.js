import fs from "node:fs";
import path from "node:path";
import { logger } from "#utils/logger.js";

export function cleanupUserDataDir(userDataDir) {
  const locks = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    "lockfile",
  ];

  locks.forEach((file) => {
    const p = path.join(userDataDir, file);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        logger.debug(`[Browser] Removed lock: ${file}`);
      } catch (e) {}
    }
  });
}
