import http from "node:http";
import net from "node:net";
import { execSync } from "node:child_process";
import express from "express";
import helmet from "helmet";
import askRouter from "./routes/ask.js";
import sessionsRouter from "./routes/sessions.js";
import agentRouter from "./routes/agent.js";
import healthRouter from "./routes/health.js";
import screenshotRouter from "./routes/screenshot.js";
import navigateRouter from "./routes/navigate.js";
import promptRouter from "./routes/prompt.js";
import setupRouter from "./routes/setup.js";
import devserverRouter, { killAllDevServers } from "./routes/devserver.js";
import visualAskRouter from "./routes/visual-ask.js";
import imageAskRouter from "./routes/image-ask.js";
import audioAskRouter from "./routes/audio-ask.js";
import pageInspectRouter from "./routes/page-inspect.js";
import evaluateRouter from "./routes/evaluate.js";
import clickRouter from "./routes/click.js";
import waitForRouter from "./routes/wait-for.js";
import { eventBus } from "#web/eventBus.js";
import { globalErrorHandler } from "./middleware/errorHandler.js";
import "express-async-errors";
import { logger } from "#utils/logger.js";

export const app = express();

app.use(helmet());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api/ping", healthRouter);
app.use("/api/setup", setupRouter);
app.use("/api/ask", askRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/agent", agentRouter);
app.use("/api/screenshot", screenshotRouter);
app.use("/api/navigate", navigateRouter);
app.use("/api/prompt", promptRouter);
app.use("/api/devserver", devserverRouter);
app.use("/api/visual-ask", visualAskRouter);
app.use("/api/image-ask", imageAskRouter);
app.use("/api/audio-ask", audioAskRouter);
app.use("/api/page-inspect", pageInspectRouter);
app.use("/api/evaluate", evaluateRouter);
app.use("/api/click", clickRouter);
app.use("/api/wait-for", waitForRouter);

app.get("/api/sync", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");

  const listener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventBus.on("sync_event", listener);

  req.on("close", () => {
    eventBus.off("sync_event", listener);
  });
});

app.use(globalErrorHandler);

// Kill any dev servers spawned during this process lifetime on exit.
// Only wire the "exit" event here — index.js owns SIGTERM/SIGINT handlers.
process.on("exit", killAllDevServers);

// Polls until the port can be bound or the timeout expires.
// Needed on WSL2 where the kernel can hold a port for 1-3 s after kill -9.
function waitForPortFree(port, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const tester = net.createServer();
      tester.once("error", () => {
        if (Date.now() < deadline) setTimeout(check, 300);
        else resolve(false);
      });
      tester.once("listening", () => tester.close(() => resolve(true)));
      tester.listen(port, "127.0.0.1");
    };
    check();
  });
}

export function startServer(initialPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.requestTimeout = 0;
    server.headersTimeout = 0;

    server.listen(initialPort, "127.0.0.1", () => {
      logger.info(
        `Server listening on http://localhost:${initialPort} (requestTimeout disabled)`,
      );
      resolve(server);
    });

    server.on("error", async (err) => {
      if (err.code !== "EADDRINUSE") {
        reject(err);
        return;
      }

      logger.warn(
        `Port ${initialPort} already in use - attempting to kill stale process...`,
      );
      try {
        let pids = [];
        if (process.platform === "win32") {
          // Use PowerShell to find PIDs listening on the port (avoids PATH issues)
          const psExe = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
          const psOut = execSync(
            `"${psExe}" -NoProfile -Command "Get-NetTCPConnection -LocalPort ${initialPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
            { stdio: ["pipe", "pipe", "pipe"] },
          ).toString();
          pids = psOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        } else {
          const lsofOut = execSync(`lsof -ti :${initialPort} 2>/dev/null || true`)
            .toString()
            .trim();
          pids = lsofOut.split("\n").filter(Boolean);
        }
        if (pids.length === 0) {
          // No owning process found (port may be in kernel cleanup / TIME_WAIT).
          // Fall through to waitForPortFree so we can retry binding once it clears.
          logger.warn(
            `[Server] No owning PID found for port ${initialPort}; waiting for OS to release it...`,
          );
        }
        for (const pid of pids) {
          logger.warn(
            `  Killing stale process PID ${pid} on port ${initialPort}`,
          );
          if (process.platform === "win32") {
            try {
              execSync(`C:\\Windows\\System32\\taskkill.exe /F /PID ${pid}`, { stdio: "pipe" });
            } catch {
              // Ignore if process already gone
            }
          } else {
            execSync(`kill -9 ${pid} 2>/dev/null || true`);
          }
        }
      } catch (killErr) {
        // If the PID-lookup itself failed, still try waiting for the port to free.
        logger.warn(
          `[Server] PID lookup failed (${killErr.message}); waiting for port to free anyway...`,
        );
      }

      // Poll until the OS actually releases the port (WSL2 can take 1-3 s).
      logger.info(`[Server] Waiting for port ${initialPort} to be released...`);
      const released = await waitForPortFree(initialPort);
      if (!released) {
        reject(
          new Error(
            `Port ${initialPort} still in use after 6 s — unable to start server.`,
          ),
        );
        return;
      }

      const retryServer = http.createServer(app);
      retryServer.requestTimeout = 0;
      retryServer.headersTimeout = 0;
      retryServer.listen(initialPort, "127.0.0.1", () => {
        logger.info(
          `Server listening on http://localhost:${initialPort} (restarted after killing stale process)`,
        );
        resolve(retryServer);
      });
      retryServer.on("error", (retryErr) => reject(retryErr));
    });
  });
}
