// T-075 redo: live A/B reproduction — a bridge sharing another's Chrome
// via CDP_URL must NOT kill it on its own clean shutdown.
//
// Never the real logged-in Chrome (port 9222) — both bridges here use a
// throwaway profile on a spare CDP port, same safety rule T-064 used.
//
// PLATFORM FINDING (kept from the first attempt, still true): on this
// Windows box there is no automatable way to deliver a real, handler-
// invoking SIGINT to an EXTERNAL Node process — both
// ChildProcess.kill("SIGINT") and process.kill(externalPid, "SIGINT")
// forcefully terminate the target instead. T-060's own committed
// evidence/t060-instanceA.log shows the same signature (no "[Shutdown]"
// log on the process it SIGTERM'd) — a prior summary of that ticket had
// assumed it proved signal delivery works; it didn't.
//
// WHAT THE FIRST ATTEMPT AT THIS EVIDENCE GOT WRONG, per review: it
// worked around the platform limit by asserting a hardcoded `null` into
// shouldKillOwnChromeOnShutdown() and calling that "the real chromePid" —
// an instrument that cannot register any other reading isn't a
// measurement. The actual fix is one layer up: src/index.js:204's
// `process.on("SIGINT", shutdown)` is a plain EventEmitter listener, and
// init() is exported. evidence/t075-bridge-b-selfshutdown.mjs (spawned
// below as bridge B) calls that same init() in its own process, reads
// internalState.chromePid AFTER boot (a real runtime read, not an
// assertion), and then calls `process.emit("SIGINT")` in-process — no OS
// event, console, TTY, or pty needed, and shutdown() actually runs.
import { spawn, execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";

const REPO = "C:/Users/Work/browser-ai-bridge";
const A_PORT = 3347;
const B_PORT = 3348;
const CDP_PORT = 9241;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function waitForReady(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/ping`);
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`bridge on port ${port} never became ready`);
}

function spawnBridge(scriptPath, env, label) {
  const child = spawn("node", [scriptPath], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let combinedLog = "";
  child.stdout.on("data", (d) => {
    combinedLog += d.toString();
    process.stdout.write(`[${label}] ${d}`.replace(/\n$/, "\n"));
  });
  child.stderr.on("data", (d) => {
    combinedLog += d.toString();
    process.stderr.write(`[${label}] ${d}`.replace(/\n$/, "\n"));
  });
  return { child, getLog: () => combinedLog };
}

function findChromeMainPid(cdpPort) {
  const out = execSync(
    `wmic process where "name='chrome.exe'" get ProcessId,CommandLine`,
    { encoding: "utf8" },
  );
  for (const line of out.split("\n")) {
    if (
      line.includes(`--remote-debugging-port=${cdpPort}`) &&
      !line.includes("--type=")
    ) {
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function chromeAlive(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}"`, {
      encoding: "utf8",
    });
    return out.includes(String(pid));
  } catch {
    return false;
  }
}

async function main() {
  log("Spawning bridge A (victim) — spawns its OWN throwaway Chrome");
  const a = spawnBridge(
    "src/index.js",
    {
      PORT: String(A_PORT),
      CDP_URL,
      CDP_PORT: String(CDP_PORT),
      BROWSER_AI_PROVIDERS: "chatgpt",
      CHROME_TMP: "t075-repro-profile",
    },
    "A",
  );

  const pingA = await waitForReady(A_PORT);
  log(`Bridge A ready: loadedCommit=${pingA.loadedCommit}`);

  const aChromePid = findChromeMainPid(CDP_PORT);
  log(`Bridge A's own Chrome main process PID: ${aChromePid}`);
  if (!aChromePid) throw new Error("could not find bridge A's Chrome PID");

  log(
    "Spawning bridge B (sharer) — evidence/t075-bridge-b-selfshutdown.mjs, " +
      "points at A's Chrome via matching CDP_URL/CDP_PORT, and will call " +
      "the real init() + emit its own SIGINT once ready",
  );
  const b = spawnBridge(
    "evidence/t075-bridge-b-selfshutdown.mjs",
    {
      PORT: String(B_PORT),
      CDP_URL,
      CDP_PORT: String(CDP_PORT),
      BROWSER_AI_PROVIDERS: "chatgpt",
      CHROME_TMP: "t075-repro-profile",
    },
    "B",
  );

  const bExit = await new Promise((resolve) => {
    b.child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  log(`Bridge B process exited: code=${bExit.code} signal=${bExit.signal}`);

  const bLog = b.getLog();

  const chromePidMatch = bLog.match(/B_CHROME_PID=(\S+)/);
  const bChromePidRaw = chromePidMatch ? chromePidMatch[1] : null;
  log(
    `Bridge B's real, live internalState.chromePid (read AFTER boot, not asserted): ${bChromePidRaw}`,
  );
  // This is the assertion the first attempt at this evidence was missing —
  // capable of actually failing if a future change ever sets chromePid on
  // the Chrome-reuse path.
  const chromePidWasNull = bChromePidRaw === "null";
  if (!chromePidWasNull) {
    log(
      `FAIL: expected bridge B's chromePid to be null (it never spawned its own Chrome) — got "${bChromePidRaw}"`,
    );
  }

  const emittedSigint = bLog.includes("B_EMITTING_SIGINT");
  const shutdownLogLine =
    "[Shutdown] No Chrome process owned by this bridge — leaving a shared/borrowed Chrome running.";
  const shutdownRanCorrectBranch = bLog.includes(shutdownLogLine);
  log(`Bridge B emitted its own SIGINT: ${emittedSigint}`);
  log(
    `Bridge B's shutdown() printed the "skip the kill" log line: ${shutdownRanCorrectBranch}`,
  );

  // Give the OS a moment in case anything async (taskkill's own process
  // teardown, etc.) is still landing.
  await new Promise((r) => setTimeout(r, 1000));

  const aChromeAliveAfter = chromeAlive(aChromePid);
  log(
    `Bridge A's Chrome (PID ${aChromePid}) alive AFTER bridge B's real shutdown(): ${aChromeAliveAfter}`,
  );

  log("Cleaning up bridge A (force — teardown, not part of the test)");
  a.child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  try {
    const pid = findChromeMainPid(CDP_PORT);
    if (pid) execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
  } catch {}

  const pass =
    chromePidWasNull &&
    emittedSigint &&
    shutdownRanCorrectBranch &&
    aChromeAliveAfter;

  const result = {
    pingA: { loadedCommit: pingA.loadedCommit, status: pingA.status },
    aChromePid,
    bExit,
    bChromePidRaw,
    chromePidWasNull,
    emittedSigint,
    shutdownRanCorrectBranch,
    aChromeAliveAfter,
    pass,
  };

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 2;
});
