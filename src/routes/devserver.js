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
import fs from "node:fs/promises";
import path from "node:path";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";

const router = Router();

// Map<pid, { proc, projectDir, port, logLines }>
const registry = new Map();

// ── Framework detection ────────────────────────────────────────────────────

async function detectFramework(projectDir) {
  try {
    const raw = await fs.readFile(
      path.join(projectDir, "package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
      deps["vite"] ||
      deps["@vitejs/plugin-react"] ||
      deps["@vitejs/plugin-vue"]
    )
      return "vite";
    if (deps["next"]) return "next";
    if (deps["react-scripts"]) return "cra";
    if (deps["@remix-run/dev"] || deps["@remix-run/react"]) return "remix";
    if (deps["nuxt"]) return "nuxt";
  } catch {
    /* no package.json or malformed — use defaults */
  }
  return "generic";
}

function buildEnvAndCommand(framework, baseCommand, port) {
  const env = { ...process.env, PORT: String(port) };
  let command = baseCommand;

  switch (framework) {
    case "vite":
      // Vite reads PORT but --port flag takes precedence and is more reliable
      if (!/--port/.test(command)) command = command + ` -- --port ${port}`;
      break;
    case "next":
      // Next.js reads PORT env var; also support -p flag injection for clarity
      if (!/(-p\s|--port)/.test(command)) command = command + ` -- -p ${port}`;
      break;
    case "nuxt":
      env.NUXT_PORT = String(port);
      if (!/--port/.test(command)) command = command + ` -- --port ${port}`;
      break;
    case "cra":
    case "remix":
    case "generic":
      // These all read PORT from env — no extra flags needed
      break;
  }

  return { env, command };
}

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

  const framework = await detectFramework(projectDir);
  const { env, command: resolvedCmd } = buildEnvAndCommand(
    framework,
    command,
    port,
  );
  logger.info(
    `[DevServer] framework=${framework} cmd=${resolvedCmd} port=${port}`,
  );

  const logLines = [];
  // detached: true creates a new process group so we can kill the whole tree
  // (shell → npm → vite) with a single process.kill(-pid) call.
  const proc = spawn(resolvedCmd, {
    cwd: projectDir,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  const pushLog = (d) => {
    logLines.push(d.toString());
    if (logLines.length > 200) logLines.shift();
  };
  proc.stdout.on("data", pushLog);
  proc.stderr.on("data", pushLog);

  const ready = await waitForReady(port);
  if (!ready) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
    // Brief delay so the OS releases the port before the error response is sent.
    await new Promise((r) => setTimeout(r, 1000));
    return sendError(res, 503, "Dev server did not become ready in 45s", {
      logs: logLines.join("").slice(-3000),
    });
  }

  registry.set(proc.pid, { proc, projectDir, port, logLines });
  logger.info(
    `[DevServer] started pid=${proc.pid} port=${port} dir=${projectDir}`,
  );
  return sendSuccess(res, {
    pid: proc.pid,
    url: `http://localhost:${port}`,
    ready: true,
  });
});

// GET /api/devserver — list all running dev servers
router.get("/", (req, res) => {
  const servers = [];
  for (const [pid, { projectDir, port }] of registry) {
    servers.push({ pid, projectDir, port, url: `http://localhost:${port}` });
  }
  return sendSuccess(res, { servers, count: servers.length });
});

// GET /api/devserver/logs/:pid — last N lines of stdout+stderr
router.get("/logs/:pid", (req, res) => {
  const pid = Number(req.params.pid);
  const entry = registry.get(pid);
  if (!entry)
    return sendError(res, 404, `No running dev server with pid ${pid}`);

  const lines = Number(req.query.lines) || 100;
  const allLogs = entry.logLines.join("");
  const trimmed = allLogs.slice(-lines * 120); // rough estimate: 120 chars/line
  return sendSuccess(res, { pid, port: entry.port, logs: trimmed });
});

// DELETE /api/devserver/:pid
router.delete("/:pid", (req, res) => {
  const pid = Number(req.params.pid);
  const entry = registry.get(pid);
  if (!entry) return res.sendStatus(404);

  // Kill the entire process group (shell → npm → vite) to prevent orphan Vite
  // processes from holding ports open across subsequent verifier passes.
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    entry.proc.kill("SIGKILL");
  }
  registry.delete(pid);

  logger.info(`[DevServer] killed pid=${pid}`);
  return res.sendStatus(204);
});

export function getDevServerCount() {
  return registry.size;
}

export function killAllDevServers() {
  for (const [pid, { proc }] of registry) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }
    registry.delete(pid);
  }
}

export default router;
