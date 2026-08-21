// T-075 redo: this file IS bridge B — a real, complete bridge instance,
// not a wrapper around one. It calls the exact same init() src/index.js's
// own CLI entry point calls, then triggers ITS OWN registered SIGINT
// handler in-process.
//
// Why in-process rather than an external OS signal: two independent
// attempts to deliver SIGINT to an external Node process on this Windows
// box (ChildProcess.kill("SIGINT") and process.kill(externalPid,
// "SIGINT")) both forcefully terminated the target instead of invoking
// its registered process.on("SIGINT", ...) handler — a Windows platform
// limitation, not something fixable from outside the process. But
// src/index.js:204's `process.on("SIGINT", shutdown)` is a plain
// EventEmitter listener on the `process` object. `process.emit("SIGINT")`
// invokes it directly, in the SAME process, with no OS event, console,
// TTY, or pty involved — this is that.
//
// chromePid is read from the real, live internalState AFTER init()
// resolves, not asserted or hardcoded — the whole point of measuring it
// here instead of stating it. If a future change ever set chromePid on
// the Chrome-reuse path, `B_CHROME_PID=<pid>` below would print a real
// number instead of "null" and the orchestrator (t075-repro.mjs) that
// spawns this file is written to fail the run on exactly that.
import { init } from "../src/index.js";
import { browserInternalState } from "../src/browser.js";

async function main() {
  await init();

  console.log(`B_CHROME_PID=${browserInternalState.chromePid}`);

  // Let stdout actually flush before triggering a shutdown that ends in
  // process.exit(0) — a solid write, not a race with the pipe.
  await new Promise((r) => setTimeout(r, 300));

  console.log("B_EMITTING_SIGINT");
  process.emit("SIGINT");
}

main().catch((e) => {
  console.error("B_FATAL:", e);
  process.exit(2);
});
