import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// T-108 clause 1: nothing in src/ai/ recorded which selector matched a
// multi-selector resolution — so a wrong pick could never be confirmed OR
// refuted from a real session, and the ordering behind 37 of 40 `.locator()`
// call sites was neither auditable nor auditably safe. One durable JSON
// line per resolution, appended here rather than console.log'd — a message
// that reaches only a console this board overwrites is
// lessons/what-a-clone-gets.md's durable-channel-carries-the-count fault.
// A fixed filename, unlike SessionLogger's per-session .log files
// (src/session/Logger.js), which are pruned to the newest 5 — this file
// accumulates across restarts so "after one ordinary session" is
// answerable by reading it, not by having watched the console live.
// logs/ is gitignored (this is runtime evidence, not committed history);
// durability here means "survives to be read after a session", not
// "tracked in git".
const LOG_PATH = path.join(process.cwd(), "logs", "locator-resolutions.jsonl");

export function recordLocatorResolution(
  {
    provider,
    key,
    matchCount,
    pickedIndex,
    pickedSelector,
    distinctVisibleElements,
  },
  logPath = LOG_PATH,
) {
  const entry = {
    ts: new Date().toISOString(),
    provider,
    key,
    matchCount,
    pickedIndex,
    pickedSelector,
    // T-111: matchCount counts SELECTORS that matched, not distinct
    // ELEMENTS (T-108's own finding — several selectors often describe one
    // box). null when matchCount <= 1 (nothing to compare) or the caller
    // didn't compute it; a real number is how many of the matchCount
    // visible selectors resolved to a DIFFERENT bounding box, which is
    // this ticket's actual question — same-element collisions are the
    // normal, harmless case the list's order cannot get wrong.
    distinctVisibleElements:
      distinctVisibleElements === undefined ? null : distinctVisibleElements,
  };
  // Same guard src/session/Manager.js already uses for its own
  // real-file side effect: a test exercising production code through the
  // DEFAULT path (no explicit logPath override) must not grow the real
  // logs/locator-resolutions.jsonl on every `npm test` run. A test that
  // passes its own logPath (this file's own unit tests do) always writes,
  // since that path is isolated by construction.
  if (logPath === LOG_PATH && process.env.NODE_ENV === "test") {
    return entry;
  }
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Recording a resolution must never be the reason a real turn fails.
  }
  return entry;
}

export function readLocatorResolutions(logPath = LOG_PATH) {
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
