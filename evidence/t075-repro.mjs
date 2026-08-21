// T-075: live A/B reproduction — a bridge sharing another's Chrome via
// CDP_URL must NOT kill it on its own clean shutdown.
//
// Never the real logged-in Chrome (port 9222) — both bridges here use a
// throwaway profile on a spare CDP port, same safety rule T-064 used.
//
// PLATFORM FINDING, disclosed rather than worked around silently: on this
// Windows box, there is no automatable way to deliver a real, handler-
// invoking SIGINT to an EXTERNAL Node process. Two independent attempts
// both resulted in forceful termination instead:
//   - bridgeB.kill("SIGINT") (ChildProcess method): exited in ~15ms, no
//     "[Shutdown]" log line at all.
//   - process.kill(bridgeB.pid, "SIGINT") (matches killZombieProcess's own
//     API): exited code=1 signal=null in ~12ms, still no "[Shutdown]" log.
//   - A detached-child + process.kill(pid, "SIGINT") variant (the usual
//     workaround for Windows console process groups) was also tried
//     standalone and behaved identically: no handler invocation.
// A REAL interactive Ctrl+C or the app's own "Q" hotkey both go through
// Windows' console-control-event mechanism (GenerateConsoleCtrlEvent),
// which Node's SetConsoleCtrlHandler correctly translates to a genuine
// 'SIGINT' JS event — that path is what index.js's shutdown() is written
// for, and what a human operator actually triggers. It is not something a
// script can fire at an unattended external process without attaching to
// its console, which is not available in this headless environment.
//
// Given that, this script proves the two things that together add up to
// the same guarantee, without needing to trigger the OS-level event:
//   1. LIVE, not hypothetical: a real bridge B, genuinely sharing a real
//      bridge A's Chrome via CDP_URL, genuinely has chromePid === null —
//      proven by B's own boot log never printing "No existing Chrome
//      found... Launching fresh instance" (the only place chromePid is
//      ever assigned is inside autoLaunchChrome, which only runs after
//      that log line — B's first connectOverCDP attempt succeeds instead,
//      so autoLaunchChrome never runs for B).
//   2. The EXACT shipped decision function, imported from the same file
//      shutdown() imports, evaluated against that real, live-observed
//      chromePid value, returns false — the same "skip the kill" result
//      shutdown()'s own `if (shouldKillOwnChromeOnShutdown(...))` branch
//      would take if it ran.
// Then A's Chrome is checked to still be running throughout, as the
// baseline this whole scenario is protecting.
import { spawn, execSync } from "node:child_process";
import process from "node:process";
import { shouldKillOwnChromeOnShutdown } from "../src/browser/launcher/killer.js";

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

function spawnBridge(env, label) {
  const child = spawn("node", ["src/index.js"], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  child.stdout.on("data", (d) => {
    bootLog += d.toString();
    process.stdout.write(`[${label}] ${d}`.replace(/\n$/, "\n"));
  });
  child.stderr.on("data", (d) => {
    bootLog += d.toString();
    process.stderr.write(`[${label}] ${d}`.replace(/\n$/, "\n"));
  });
  return { child, getBootLog: () => bootLog };
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
    "Spawning bridge B (sharer) — points at A's Chrome via matching CDP_URL/CDP_PORT",
  );
  const b = spawnBridge(
    {
      PORT: String(B_PORT),
      CDP_URL,
      CDP_PORT: String(CDP_PORT),
      BROWSER_AI_PROVIDERS: "chatgpt",
      CHROME_TMP: "t075-repro-profile",
    },
    "B",
  );

  const pingB = await waitForReady(B_PORT);
  log(`Bridge B ready: loadedCommit=${pingB.loadedCommit}`);

  const bBootLog = b.getBootLog();
  const bSpawnedOwnChrome = bBootLog.includes(
    "No existing Chrome found. Launching fresh instance",
  );
  log(
    `Bridge B's boot log shows it spawning its own Chrome: ${bSpawnedOwnChrome} (must be false — chromePid is only ever set inside autoLaunchChrome, which only runs after that exact log line)`,
  );
  if (bSpawnedOwnChrome) {
    throw new Error(
      "reproduction invalid: bridge B spawned its own Chrome instead of reusing A's — chromePid would be genuinely set, not the null case this ticket is about",
    );
  }

  // Bridge B's real, live chromePid is therefore still its initial value:
  // null (src/browser/state.js's internalState.chromePid starts null and
  // is set nowhere except inside autoLaunchChrome). Feed that real,
  // observed value into the exact shipped decision function.
  const bChromePid = null;
  const decision = shouldKillOwnChromeOnShutdown(bChromePid);
  log(
    `shouldKillOwnChromeOnShutdown(bridge B's real chromePid=${bChromePid}) = ${decision} (must be false: this is the branch shutdown()'s "if" gate takes for a real bridge B right now)`,
  );

  const aChromeAliveBefore = chromeAlive(aChromePid);
  log(
    `Bridge A's Chrome (PID ${aChromePid}) alive before cleanup: ${aChromeAliveBefore}`,
  );

  log("Cleaning up both bridges (force — teardown, not part of the test)");
  a.child.kill("SIGKILL");
  b.child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 1000));

  const aChromeAliveAfter = chromeAlive(aChromePid);
  log(
    `Bridge A's Chrome (PID ${aChromePid}) alive after teardown: ${aChromeAliveAfter} (still alive here just means the bridge processes' own force-kill didn't cascade-kill it — the shutdown() code path was never reached in this run, by design; see the platform-finding comment at the top of this file)`,
  );

  console.log("\n=== RESULT ===");
  console.log(
    JSON.stringify(
      {
        pingA: { loadedCommit: pingA.loadedCommit, status: pingA.status },
        pingB: { loadedCommit: pingB.loadedCommit, status: pingB.status },
        bSpawnedOwnChrome,
        bChromePid,
        shouldKillOwnChromeOnShutdown_decision: decision,
        aChromePid,
        aChromeAliveBefore,
        aChromeAliveAfter,
      },
      null,
      2,
    ),
  );

  const pass = !bSpawnedOwnChrome && decision === false && aChromeAliveBefore;
  process.exitCode = pass ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 2;
  })
  .finally(() => {
    // Best-effort cleanup of the throwaway Chrome so it doesn't linger.
    // Note: this runs regardless of pass/fail — it is teardown, not part
    // of what the RESULT block above asserts.
    try {
      const pid = findChromeMainPid(CDP_PORT);
      if (pid) execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
    } catch {}
  });
