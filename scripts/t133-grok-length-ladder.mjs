#!/usr/bin/env node
/**
 * t133-grok-length-ladder.mjs — T-133. T-059 closed the mechanism question
 * (`.last()` is never our own bubble inside the window poll.js decides in)
 * and left the CAUSE of T-054's four echoing turns open. The one variable
 * nobody has moved: every echoing turn on record — T-054's four, T-072's
 * five blind ones — used ONE prompt of ONE length, vision-probe.mjs's
 * buildPrompt() (313 chars / 315 UTF-8 bytes, measured — not the "~500"
 * T-059's own log guessed at, which this ticket does not repeat). T-059's
 * two in-window turns, at that SAME length, did NOT echo. Length alone
 * cannot be the whole story, but nobody has run a ladder to find out
 * whether it is A story.
 *
 * This drives grok LIVE via the running bridge's real /api/ask route —
 * `providers: ["grok"]`, no `images` key at all (T-072's blind arm; T-072
 * already established blind and image-attached turns echo at the same
 * rate, so the upload path is not a needed variable here) — the same
 * production path every other measurement on this board used, not a
 * bespoke CDP driver.
 *
 * FOUR RUNGS, THREE TURNS EACH, chosen to bracket grok's own chunkSize
 * boundary (src/ai/grok/interaction/prompt/input.js's injectGrokText
 * passes chunkSize: 4000 to clearAndType — the ~313-char probe prompt
 * never crosses it):
 *   short    ~90 chars    — well below the known 313-char length
 *   control  313 chars    — vision-probe.mjs's buildPrompt(), byte-
 *                            identical (same literal T-059's own script
 *                            duplicated) — the length every prior echoing
 *                            AND non-echoing turn on record actually used
 *   mid      ~2000 chars  — between control and the chunkSize boundary
 *   long     ~4500 chars  — above the 4000-char chunkSize boundary
 *
 * mid/long are the control's own head/core/tail with a neutral filler
 * sentence inserted between head and core — the anchor phrase ("Look at
 * the attached image ONLY") stays at the very start and "SEES=no" stays
 * at the very end of every rung, so classify()'s ECHO/SEES_NO detection
 * (which pattern-matches on those two substrings) works identically at
 * every rung regardless of padding.
 *
 * Classified by this repo's own classify()/classifyBlind() — imported,
 * never grepped by hand. A hand grep for "SEES=no" scores an echoed
 * prompt as a refusal, because the prompt's own fallback clause contains
 * that literal string; classify() checks for ECHO first specifically to
 * avoid that trap (a prior session on this board was caught by it once).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  classifyBlind,
  compareServerCommit,
  classifyServerProvenance,
  resolveAnsweredBy,
} from "./vision-probe.mjs";

const BASE_URL = process.env.VISION_PROBE_BASE_URL || "http://localhost:3333";
const TURNS_PER_RUNG = 3;
const TIMEOUT_MS = 120000;
const TURN_LABEL = "API Turn: t133-grok-length-ladder";

const ANCHOR_HEAD =
  `Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, ` +
  `no other text:\n\n`;
const CORE_MID =
  `SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest ` +
  `match from exactly this list: crimson, teal, goldenrod, indigo>`;
const ANCHOR_TAIL = `\n\n...or reply with EXACTLY this if you cannot see any image at all:\n\nSEES=no`;

// Byte-identical to vision-probe.mjs's buildPrompt() (COLORS is
// {crimson, teal, goldenrod, indigo} there too) — same duplication T-059's
// own script already made, for the same reason: this is the CONTROL rung,
// and it has to be the exact prompt every prior echoing/non-echoing turn
// on record actually used, not a paraphrase of it.
function buildControlPrompt() {
  return ANCHOR_HEAD + CORE_MID + ANCHOR_TAIL;
}

// A short, condensed prompt — NOT a truncation of the control (truncating
// would drop ANCHOR_TAIL's "SEES=no", which classify()'s SEES_NO check
// needs) — that keeps both anchor substrings ECHO/SEES_NO detection reads,
// well under the control's 313 chars.
function buildShortPrompt() {
  return (
    "Look at the attached image ONLY — do not guess. Reply with SEES=yes " +
    "or SEES=no, nothing else."
  );
}

// The control's own head/core/tail, with a neutral filler sentence
// repeated between head and core until the total reaches targetLen. Pads
// ONLY — never truncates the fixed parts — so a target below the fixed
// length (head+core+tail) throws rather than silently shipping the
// control's own length under a different rung's name.
function buildPaddedPrompt(targetLen) {
  const fixedLen = ANCHOR_HEAD.length + CORE_MID.length + ANCHOR_TAIL.length;
  if (targetLen < fixedLen) {
    throw new Error(
      `buildPaddedPrompt(${targetLen}): below the fixed head+core+tail length ` +
        `(${fixedLen}) — this function pads, it does not truncate.`,
    );
  }
  const fillerSentence =
    "The squares are solid colours only, nothing else is drawn on the canvas. ";
  let filler = "";
  while (fixedLen + filler.length < targetLen) filler += fillerSentence;
  filler = filler.slice(0, targetLen - fixedLen);
  return ANCHOR_HEAD + filler + CORE_MID + ANCHOR_TAIL;
}

const LADDER = [
  { rung: "short", prompt: buildShortPrompt() },
  { rung: "control", prompt: buildControlPrompt() },
  { rung: "mid", prompt: buildPaddedPrompt(2000) },
  { rung: "long", prompt: buildPaddedPrompt(4500) },
];

// Same provenance shape as vision-probe.mjs's gradingProvenance() —
// duplicated rather than imported because that function is not exported
// (T-059's own script made the same call for buildPrompt()). bridgeCommit
// answers "what does HEAD say"; serverLoadedCommit answers "what did the
// SERVER PROCESS actually load" — Node does not hot-reload, so these two
// can disagree even when HEAD hasn't moved since the last restart.
async function pinServer() {
  let bridgeCommit = null;
  let treeDirty = null;
  let dirtyPaths = null;
  try {
    bridgeCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    dirtyPaths = execSync("git diff --name-only HEAD", { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    treeDirty = dirtyPaths.length > 0;
  } catch {
    // Unmeasured — see vision-probe.mjs's reader contract for why this
    // stays null rather than collapsing to false.
  }
  let serverLoadedCommit = null;
  let serverTreeDirty = null;
  try {
    const res = await fetch(`${BASE_URL}/api/ping`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    if (typeof json.loadedCommit === "string")
      serverLoadedCommit = json.loadedCommit;
    if (typeof json.loadedTreeDirty === "boolean")
      serverTreeDirty = json.loadedTreeDirty;
  } catch {
    // Unmeasured.
  }
  const serverStale = compareServerCommit(bridgeCommit, serverLoadedCommit);
  const serverProvenance = classifyServerProvenance(
    serverStale,
    serverTreeDirty,
  );
  return {
    bridgeCommit,
    treeDirty,
    ...(treeDirty ? { dirtyPaths } : {}),
    serverLoadedCommit,
    serverStale,
    serverTreeDirty,
    serverProvenance,
  };
}

const REQUESTED_PROVIDER = "grok";

async function sendBlindTurn(prompt) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [REQUESTED_PROVIDER],
        prompt,
        label: TURN_LABEL,
        // No `images` key — the blind arm, same as vision-probe.mjs's
        // askProviderBlind().
      }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ...resolveAnsweredBy(REQUESTED_PROVIDER, json),
        elapsedMs,
        shape: "ERROR",
        detail: `HTTP ${res.status}: ${json?.error || "(no error field)"}`,
      };
    }
    const { shape, stated } = classifyBlind(json.response);
    return {
      ...resolveAnsweredBy(REQUESTED_PROVIDER, json),
      elapsedMs,
      shape,
      stated,
      raw: json.response,
    };
  } catch (err) {
    return {
      ...resolveAnsweredBy(REQUESTED_PROVIDER, null),
      elapsedMs: Date.now() - started,
      shape: "ERROR",
      detail: err.name === "AbortError" ? "timeout" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const provenance = await pinServer();
  console.log(
    `[t133] server provenance: ${provenance.serverProvenance} ` +
      `(bridgeCommit=${provenance.bridgeCommit}, serverLoadedCommit=${provenance.serverLoadedCommit}, ` +
      `serverTreeDirty=${provenance.serverTreeDirty})`,
  );
  if (provenance.serverProvenance !== "verified") {
    console.warn(
      `[t133] WARNING: server provenance is "${provenance.serverProvenance}", not "verified" — ` +
        `every turn below ran against whatever the server actually has loaded, which may not be ` +
        `provenance.bridgeCommit.`,
    );
  }

  const rungs = [];
  for (const { rung, prompt } of LADDER) {
    console.log(
      `\n[t133] === rung "${rung}" — prompt length ${prompt.length} chars (${Buffer.byteLength(prompt, "utf8")} UTF-8 bytes) ===`,
    );
    const turns = [];
    for (let i = 0; i < TURNS_PER_RUNG; i++) {
      console.log(`[t133]   turn ${i + 1}/${TURNS_PER_RUNG}...`);
      const result = await sendBlindTurn(prompt);
      console.log(
        `[t133]     shape=${result.shape} elapsedMs=${result.elapsedMs} answeredBy=${result.answeredBy}` +
          (result.answeredByMismatch
            ? ` <<< MISMATCH (asked ${REQUESTED_PROVIDER})`
            : "") +
          (result.detail ? ` detail=${result.detail}` : ""),
      );
      turns.push(result);
    }
    const echoCount = turns.filter((t) => t.shape === "ECHO").length;
    const mismatchCount = turns.filter((t) => t.answeredByMismatch).length;
    rungs.push({
      rung,
      promptLength: prompt.length,
      promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
      prompt,
      echoCount,
      mismatchCount,
      turnCount: turns.length,
      turns,
    });
    console.log(
      `[t133] rung "${rung}" done: ECHO ${echoCount} of ${turns.length}, answered by someone other than asked ${mismatchCount} of ${turns.length}`,
    );
  }

  const outPath =
    process.argv[2] || `evidence/t133-grok-length-ladder-${Date.now()}.json`;
  const output = {
    ts: new Date().toISOString(),
    baseUrl: BASE_URL,
    turnsPerRung: TURNS_PER_RUNG,
    ...provenance,
    rungs,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  console.log("\n[t133] === SUMMARY ===");
  for (const r of rungs) {
    console.log(
      `  ${r.rung.padEnd(8)} len=${String(r.promptLength).padStart(5)}  ECHO ${r.echoCount}/${r.turnCount}  ` +
        `mismatch ${r.mismatchCount}/${r.turnCount}  ` +
        `elapsedMs=[${r.turns.map((t) => t.elapsedMs).join(", ")}]`,
    );
  }
  const totalMismatch = rungs.reduce((a, r) => a + r.mismatchCount, 0);
  const totalTurns = rungs.reduce((a, r) => a + r.turnCount, 0);
  console.log(
    `[t133] answered by someone other than asked, overall: ${totalMismatch}/${totalTurns}`,
  );
  console.log(`[t133] report written to ${outPath}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
