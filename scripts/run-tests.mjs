#!/usr/bin/env node
// `npm test`: run `node --test` with NODE_ENV=test, on every platform.
//
// The script used to be `NODE_ENV=test node --test`. That is POSIX shell syntax, and npm on
// Windows runs scripts through cmd.exe, which answers "'NODE_ENV' is not recognized" and runs
// nothing. Worse than a failed run would be a run WITHOUT the variable: the session modules must
// never load outside NODE_ENV=test in a process that can reach the real browser (CLAUDE.md,
// "Tests"), so the variable is set here rather than left to the caller's shell.
//
// Extra arguments go straight to `node --test` (e.g. `npm test -- tests/api.test.js`).
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
