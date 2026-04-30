/**
 * POST /api/devserver  { projectDir, command, port }
 *   Spawns a dev server (e.g. `npm run dev`) in the given project directory,
 *   waits until it responds on the chosen port, and returns { pid, url, ready }.
 *
 * DELETE /api/devserver/:pid
 *   Kills the previously started dev server by pid.
 *
 * Used by agent-core's visual verification step to spin up a live preview of
 * a React/Vite project so Claude Vision can screenshot and inspect the UI.
 */

import { Router } from "express";
import { spawn } from "node:child_process";
import net from "node:net";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = Router();

// Map<pid, { proc, projectDir, port, logLines }>
const registry = new Map();

async function findFreePort(preferred, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const port = preferred + i;
    const free = await new Promise((resolve) => {
      const t = net.createServer();
      t.once("error", () => resolve(false));
      t.once("listening", () => t.close(() => resolve(true)));
      t.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error(
    `No free port found in range ${preferred}–${preferred + attempts - 1}`,
  );
}

async function waitForReady(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.status) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// POST /api/devserver
router.post("/", async (req, res) => {
  const {
    projectDir,
    command = "npm run dev",
    port: preferredPort = 5173,
  } = req.body;

  if (!projectDir) return sendError(res, 400, "Missing projectDir");

  let port;
  try {
    port = await findFreePort(preferredPort);
  } catch (e) {
    return sendError(res, 503, e.message);
  }

  const logLines = [];
  const proc = spawn(command, {
    cwd: projectDir,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), VITE_PORT: String(port) },
  });

  const pushLog = (d) => {
    logLines.push(d.toString());
    if (logLines.length > 200) logLines.shift();
  };
  proc.stdout.on("data", pushLog);
  proc.stderr.on("data", pushLog);

  const ready = await waitForReady(port);
  if (!ready) {
    proc.kill("SIGKILL");
    return sendError(res, 503, "Dev server did not become ready in 45s", {
      logs: logLines.join("").slice(-3000),
    });
  }

  registry.set(proc.pid, { proc, projectDir, port, logLines });
  logger.info(`[DevServer] started pid=${proc.pid} port=${port} dir=${projectDir}`);
  return sendSuccess(res, { pid: proc.pid, url: `http://localhost:${port}`, ready: true });
});

// DELETE /api/devserver/:pid
router.delete("/:pid", (req, res) => {
  const pid = Number(req.params.pid);
  const entry = registry.get(pid);
  if (!entry) return res.sendStatus(404);

  entry.proc.kill("SIGTERM");
  setTimeout(() => {
    if (!entry.proc.killed) entry.proc.kill("SIGKILL");
  }, 3000);
  registry.delete(pid);

  logger.info(`[DevServer] killed pid=${pid}`);
  return res.sendStatus(204);
});

export function killAllDevServers() {
  for (const [pid, { proc }] of registry) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    registry.delete(pid);
  }
}

export default router;
