#!/usr/bin/env node
/**
 * vision-probe.mjs — the falsifiable test for T-001.
 *
 * "Describe this image" passes even when no image ever arrived, because a
 * model will happily improvise a plausible-sounding description. This probe
 * asks a question with TWO parts, and the parts are not equally hard to
 * guess (T-012 on the crew board, correcting this file's own earlier claim):
 *
 *   COUNT   a random 3-9 count of solid-colour squares. Nowhere in the
 *           prompt. This is the arrival test — 1-in-7 by chance.
 *   COLOR   one of four named colours. Its four legal answers are PRINTED
 *           IN THE PROMPT verbatim ("pick the closest match from exactly
 *           this list: ..."), so this is a closed-vocabulary compliance
 *           test, 1-in-4 by chance, and does not carry the "nothing an LLM
 *           could guess its way into" claim the way COUNT does.
 *
 * The key space the generator actually draws from is derived below (see
 * KEY_SPACE) rather than typed as a number, so this comment cannot drift
 * out of sync with COLORS or the count range the way "1-in-45" already had
 * by the time T-012 checked it (the true figure was 28, and was 28 in the
 * commit that introduced this file).
 *
 * The image is a hand-rolled PNG (raw pixel buffer + zlib deflate, no font
 * or canvas library) so this script has no dependency beyond Node itself —
 * no browser needs to be installed to generate the fixture.
 *
 * It hits the running bridge server exactly as a real caller would — HTTP,
 * one provider pinned per request via `providers: [id]` — and classifies
 * every reply into one of:
 *
 *   PASS        correct COUNT and correct COLOR
 *   COUNT_ONLY  correct COUNT, COLOR off the printed list — the arrival
 *               test passed; the compliance test did not. NOT evidence of
 *               a misread (T-012: on the one goldenrod image in this
 *               probe's recorded history, three of four healthy providers
 *               counted correctly and named the colour "yellow" instead of
 *               "goldenrod" — a vocabulary miss, not a vision failure)
 *   WRONG       COUNT itself is wrong — the model saw *something* and was
 *               confidently mistaken about it (this is not an upload bug
 *               and no upload fix will ever catch it — see Copilot's
 *               STAVES=2 finding on T-001)
 *   SEES_NO     the model explicitly said it saw no image
 *   ECHO        the reply looks like the prompt read back, not an answer
 *   NO_ANSWER   turn completed but the reply matched none of the expected
 *               shapes (garbled / off-format)
 *   ERROR       the HTTP call itself failed, or the server reported a
 *               non-2xx status, or the turn timed out
 *
 * The summary line reports COUNT and COLOR as separate numbers, with COUNT
 * — the arrival test — as the headline, rather than only the AND of both
 * (T-012: over this probe's recorded history, 12 of 13 structured answers
 * had the right count; only 8 of 13 satisfied the AND, because 4 of the
 * other 5 were a count-right/colour-off-list COUNT_ONLY wearing WRONG).
 *
 * It also prints the bridge's own `imageAttached` field next to the
 * classification, so a mismatch (imageAttached:true but SEES_NO, or
 * imageAttached:false but PASS) is visible at a glance — either would mean
 * the confirmation heuristic itself is wrong for that provider.
 *
 * Usage:
 *   node scripts/vision-probe.mjs                          # all providers, /api/ask
 *   node scripts/vision-probe.mjs --endpoint image-ask      # via /api/image-ask
 *   node scripts/vision-probe.mjs --providers gemini,copilot
 *   node scripts/vision-probe.mjs --base-url http://localhost:3333
 *   node scripts/vision-probe.mjs --break gemini             # see "Deliberate breakage" below
 *
 * Deliberate breakage (acceptance #3 — the test must be SEEN to fail):
 *   There is no env-var switch for this — breaking a provider's upload
 *   means editing its real selector (e.g. the `attachBtn` entry in
 *   src/ai/generic/specs.js, or a bespoke provider's uploadFileTo* selector)
 *   to something that cannot match, then starting a bridge instance on a
 *   spare port and running this probe against that instance with
 *   --providers pointed at just the broken one. `--break <providerId>`
 *   below only prints the exact steps — it does not edit code or start a
 *   server for you, so the failure is demonstrated deliberately.
 *
 *   T-060: the live server's OWN process is not killed by this anymore —
 *   startup used to key its stale-instance check off one pid file shared
 *   by every port, so a spare-port launch would read the live instance's
 *   pid and SIGTERM it (measured live: a bridge on 3333 killed by a
 *   launch on 3334). The pid file is now scoped by port, so that no
 *   longer happens. What a spare-port launch still touches: the shared
 *   "where is the bridge" discovery files (browser-ai-bridge-config.json
 *   and its legacy alias, read by copilot-helper/launcher.js and
 *   agent-core/bridgeClient.js) — the spare instance overwrites those with
 *   ITS OWN port while it runs, and deletes them on its own exit, so
 *   anything that discovers "the bridge" through those files during the
 *   spare instance's lifetime finds the wrong one, and finds nothing for a
 *   moment after it exits (until the live instance is itself restarted).
 *   The live server keeps running and answering on its own port
 *   throughout either way.
 */

import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

/**
 * What graded this run (T-012): a run JSON on disk carried no version of
 * anything — not this script's sha, not the bridge's, not even a
 * timestamp — so when the classifier changed (c30e73a) there was no way to
 * tell which of the 30 already-recorded runs predate the fix short of
 * comparing commit times against file mtimes by hand. Two rows were graded
 * by a classifier that no longer exists and the record did not say so.
 *
 * Deliberately NOT backfilled onto existing reports/vision-probe/*.json —
 * stamping today's shas on a run graded by yesterday's classify() would
 * convert an honest unknown into a confident falsehood. Absence of these
 * fields on an old file is the correct signal that its grading vintage is
 * unrecorded; only new runs get them.
 *
 * READER CONTRACT for every field this function can emit — the "reader
 * contract below" T-046's own commit promised and never wrote (caught in
 * T-049's review; written here, once, for every field instead of one at a
 * time as each gets added):
 *
 *   KEY ABSENT ENTIRELY  — report predates the field's own ticket. Its true
 *                          value was never measured and never will be;
 *                          absence IS the "unrecorded" signal, not a form
 *                          of false.
 *   treeDirty: null       — this ticket's logic ran but a git call inside it
 *                          threw (no checkout, git missing, REPO_ROOT wrong,
 *                          rev-parse ok but diff threw). NOT "verified
 *                          clean" — unmeasured, same shape as key-absent but
 *                          distinguishable from a pre-T-046 file because the
 *                          key is present.
 *   treeDirty: false      — measured, HEAD matched the working tree.
 *   treeDirty: true        — measured, dirtyPaths names what differed.
 *   serverLoadedCommit: null,
 *   serverStale: null      — T-049: the /api/ping call this needed either
 *                          failed outright (bridge down, network error) or
 *                          reached a bridge old enough to not carry
 *                          `loadedCommit` yet. Unmeasured, not "fresh" —
 *                          same non-negotiable rule as treeDirty: null above,
 *                          and for the same reason (T-045/T-042 both had
 *                          live evidence silently invalidated by a stale
 *                          bridge process before this field existed to catch
 *                          it — see the T-049 ticket this shipped from).
 *   serverStale: false     — measured: the bridge's own `loadedCommit`
 *                          (cached once at ITS startup, not re-read per
 *                          request — see health.js) matches this probe's own
 *                          `bridgeCommit`. The code that answered this run's
 *                          HTTP calls is the code at that commit.
 *   serverStale: true      — measured and DIFFERENT. Every result in this
 *                          report came from whatever the bridge actually
 *                          loaded at `serverLoadedCommit`, not from
 *                          `bridgeCommit`. Printed loudly to the console
 *                          when this happens (see main()) — the report
 *                          itself carries it either way, console or not.
 *   serverTreeDirty: null,
 *   serverProvenance: "unmeasured" — T-052: same failure /api/ping's ping
 *                          call can hit as serverLoadedCommit above (bridge
 *                          down, network error, or a bridge old enough not
 *                          to carry `loadedTreeDirty` yet).
 *   serverTreeDirty: false — measured: the bridge's working tree matched
 *                          its own `loadedCommit` at THE MOMENT THE SERVER
 *                          STARTED (health.js's `LOADED_TREE_DIRTY`, cached
 *                          once at process startup, same shape as
 *                          `loadedCommit` itself).
 *   serverTreeDirty: true  — measured: the bridge started from a dirty
 *                          tree — it loaded whatever the working tree held
 *                          at that moment, which may or may not equal any
 *                          commit's checked-in content, `loadedCommit`
 *                          included.
 *
 *   serverProvenance       — T-052: `serverStale` alone conflates two
 *                          opposite failures the ticket's own review found
 *                          in the ordinary edit-restart-commit loop this
 *                          board runs constantly:
 *
 *                            FALSE ALARM — edit, restart (server loads the
 *                            edited code), THEN commit. loadedCommit is the
 *                            sha from before the commit; bridgeCommit is the
 *                            new one; serverStale reads true even though the
 *                            server is running exactly the code under test.
 *
 *                            SILENT LIE — restart from a dirty tree and
 *                            never commit. loadedCommit still equals
 *                            bridgeCommit (nothing moved HEAD), so
 *                            serverStale reads a confident false, but the
 *                            server is running uncommitted edits that
 *                            `loadedCommit` never described.
 *
 *                          Both are the SAME underlying gap: `serverStale`
 *                          only ever compares two shas, and a sha says
 *                          nothing about whether the tree matched it at
 *                          startup. `serverTreeDirty` is that missing
 *                          measurement; `serverProvenance` is
 *                          `classifyServerProvenance(serverStale,
 *                          serverTreeDirty)` folding both into one of six
 *                          states a reader can check without re-deriving
 *                          the cross product themselves:
 *
 *                            "verified"          stale:false, dirty:false —
 *                                                 clean startup, sha
 *                                                 matches. No ambiguity.
 *                            "unverifiable"       stale:false, dirty:true —
 *                                                 the SILENT LIE shape: sha
 *                                                 matches but the server
 *                                                 loaded uncommitted edits,
 *                                                 so the match proves
 *                                                 nothing.
 *                            "stale-confirmed"    stale:true, dirty:false —
 *                                                 clean startup, sha moved
 *                                                 since. Genuinely running
 *                                                 old code, no ambiguity.
 *                            "stale-ambiguous"    stale:true, dirty:true —
 *                                                 the FALSE ALARM shape: sha
 *                                                 moved, but the server
 *                                                 started dirty, so the new
 *                                                 sha may just be the same
 *                                                 edits, now committed.
 *                            "stale-unmeasured-tree" / "verified-unmeasured-
 *                                                 tree" — sha comparison
 *                                                 succeeded but
 *                                                 serverTreeDirty is null;
 *                                                 cannot rule the ambiguous
 *                                                 or silent-lie shapes in or
 *                                                 out.
 *                            "unmeasured"         serverStale itself is
 *                                                 null — see serverStale:
 *                                                 null above.
 */
// T-049: pulled out of gradingProvenance() so the tri-state rule (see the
// reader contract above) is unit-testable without mocking fetch/exec — same
// reasoning as classify()/gradeReply() elsewhere in this file's own
// history. `null` in either argument means "unmeasured", and unmeasured
// must never collapse into a measured false the way T-046's own review
// caught treeDirty doing.
export function compareServerCommit(bridgeCommit, serverLoadedCommit) {
  if (bridgeCommit === null || serverLoadedCommit === null) return null;
  return serverLoadedCommit !== bridgeCommit;
}

// T-052: folds serverStale and serverTreeDirty into the single verdict the
// reader-contract block above documents — pulled out to its own function,
// same reasoning as compareServerCommit above it, so the cross product of
// two tri-states is unit-testable without mocking fetch/exec and cannot
// silently drift out of sync with the doc comment enumerating it.
export function classifyServerProvenance(serverStale, serverTreeDirty) {
  if (serverStale === null) return "unmeasured";
  if (serverStale === true) {
    if (serverTreeDirty === true) return "stale-ambiguous";
    if (serverTreeDirty === false) return "stale-confirmed";
    return "stale-unmeasured-tree";
  }
  // serverStale === false
  if (serverTreeDirty === true) return "unverifiable";
  if (serverTreeDirty === false) return "verified";
  return "verified-unmeasured-tree";
}

async function gradingProvenance(baseUrl) {
  const src = await readFile(__filename, "utf8");
  // T-074: this hashes THIS FILE'S OWN SOURCE — "which classify()/prompt/
  // fixture-generation code produced this run" — not the fixture image.
  // It used to be named probeSha256 and read across this board as fixture
  // identity ("same probeSha256 means same picture"); it never could mean
  // that, since two runs sharing this same source file draw a fresh random
  // fixture each time. See fixtureSha256 in main()'s own write, below,
  // for the field that actually hashes the PNG bytes sent.
  const graderSha256 = createHash("sha256")
    .update(src)
    .digest("hex")
    .slice(0, 16);
  let bridgeCommit = null;
  // T-046: bridgeCommit alone reads as "this is the code that produced this
  // run", but a plain `git rev-parse HEAD` says nothing about whether the
  // working tree matched HEAD at run time — the normal state of a tree
  // while a fix is being measured (committed after, not before) is exactly
  // the state this used to get silently wrong. `git diff --name-only HEAD`
  // (not `git status --porcelain`) is deliberate: it reports only TRACKED
  // files that differ from HEAD, so it never flags this run's OWN new
  // report/fixture files (untracked until a later commit) as tree dirt —
  // the question this field answers is "does HEAD's checked-in code match
  // what ran", not "is the working directory clean of any new file".
  // T-046 review: this used to initialise treeDirty to `false` — meaning a
  // caught git failure (no checkout, git missing, REPO_ROOT wrong, or `git
  // rev-parse` succeeding but `git diff` throwing) silently wrote
  // `treeDirty: false` next to a report that was never actually measured,
  // which is the exact absence/false conflation the comment two paragraphs
  // up warns readers about for T-038's cause field. `null` is a THIRD,
  // distinct state from both "absent key" (a pre-T-046 file — see the
  // reader contract above this function) and a genuinely measured
  // true/false — it says this ticket's logic ran but could not complete the
  // measurement, so a reader must not read it as "verified clean". Only
  // ever set to a real boolean once `git diff` has actually returned.
  let treeDirty = null;
  let dirtyPaths = null;
  try {
    bridgeCommit = execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    dirtyPaths = execSync("git diff --name-only HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    treeDirty = dirtyPaths.length > 0;
  } catch {
    // Not fatal — a caller running this outside a git checkout still gets
    // the probe's own sha and a timestamp, just not the bridge commit.
  }

  // T-049: bridgeCommit (above) answers "what does HEAD say" — it says
  // nothing about what the SERVER PROCESS actually has loaded in memory,
  // because Node does not hot-reload. T-042's and T-045's live verification
  // both silently ran against a bridge process that predated their own
  // fixes; nothing in a report or a gate caught it. Independent of every
  // provider result (clause 5 — a probe that only ever ERRORs must still
  // carry a correct answer here), fetch the bridge's own cached startup
  // commit and compare.
  let serverLoadedCommit = null;
  // T-052: whether the bridge's own working tree was dirty AT ITS STARTUP —
  // see LOADED_TREE_DIRTY in health.js and the reader contract above. Read
  // from the same /api/ping call as serverLoadedCommit; a second request
  // could observe a different process (a restart in between) and would
  // answer a question this probe is not asking.
  let serverTreeDirty = null;
  try {
    const res = await fetch(`${baseUrl}/api/ping`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    if (typeof json.loadedCommit === "string") {
      serverLoadedCommit = json.loadedCommit;
    }
    if (typeof json.loadedTreeDirty === "boolean") {
      serverTreeDirty = json.loadedTreeDirty;
    }
  } catch {
    // Not fatal — see the reader contract above: serverStale and
    // serverTreeDirty stay null (unmeasured), never false, when the ping
    // itself couldn't be read.
  }
  const serverStale = compareServerCommit(bridgeCommit, serverLoadedCommit);
  const serverProvenance = classifyServerProvenance(
    serverStale,
    serverTreeDirty,
  );

  return {
    graderSha256,
    bridgeCommit,
    treeDirty,
    ...(treeDirty ? { dirtyPaths } : {}),
    serverLoadedCommit,
    serverStale,
    serverTreeDirty,
    serverProvenance,
    gradedAt: new Date().toISOString(),
  };
}

// zai deliberately EXCLUDED from the default roster (T-006). Still a real,
// callable provider (src/ai/generic/specs.js) — pass --providers zai
// explicitly if you want it — but it does not belong in a sweep nobody is
// specifically asking about. Evidence: 8 attempts across two sessions on one
// day, submission click/keyboard-fallback succeeding only 3 of 8 times
// (2 ERROR "Failed to submit prompt: input did not clear and generation did
// not start", 1 ERROR 300s timeout, 2 NO_ANSWER — one a stuck "Thinking..."
// placeholder, one a truncated reply missing its final character, a
// DIFFERENT and still-unexplained fault). No single root cause identified
// the way kimi's was (a stale `.message-list` selector, fixed in this same
// commit) — the failures are three distinct shapes, not one bug wearing
// three costumes, and none of the three yielded to the diagnostic tools
// this ticket had (dom-diagnose.mjs, direct DOM inspection of the send
// button's disabled state, manual submission via Playwright). Re-add if a
// real fix lands; until then a sweep that includes it spends up to 300s
// finding out what this comment already knows.
const ALL_PROVIDERS = [
  "chatgpt",
  "gemini",
  "deepseek",
  "grok",
  "copilot",
  "kimi",
  "qwen",
  "mistral",
  "perplexity",
];

// DEFERRAL DISCHARGED (T-012 opened it, T-086 answered it — was NOT deleted,
// because a comment that was right to defer and then got answered should
// read as a settled question, not as though it had never been in doubt).
//
// T-012 left this open on 4 distinct fixtures (1 goldenrod). The corpus has
// since grown past 95 distinct fixtures (4 goldenrod) and the answer is a
// NULL: goldenrod is NOT a synonym trap. Re-derived at HEAD (128 reports,
// sha256-16 5bd60ffdb4d1ed0e — grows every session, re-run T-086's frozen
// colour-channel.mjs for today's numbers, this line is a snapshot):
//
//   goldenrod, pooled              3/7   43%
//   goldenrod, the one old image   0/4   probe-1787282150016.png
//   goldenrod, every image since   3/3   three fixtures, three providers,
//                                        three different bridge commits
//
// gemini is on BOTH sides — "yellow" on the old image, "goldenrod" on a
// later one — so this was never "gemini cannot produce the word". Both
// fixes this comment used to name are REFUSED by that number: no synonym
// list, no palette swap.
//
// THE LIMIT, carried forward rather than left implicit: n=7, and only ONE
// goldenrod fixture has ever been shown to more than one provider — it is
// the failing one. "3 of 3 since" is three single-provider rows, not three
// replications. Enough to refuse the two proposed fixes; not enough to
// declare goldenrod safe outright (L-004).
//
// What COUNT_ONLY already did right stands unchanged: a colour-word miss
// (on a real palette member or off it) does not read as a vision failure.
// T-086 additionally gave classify() a mechanical `onList` field (see the
// READER-FACING NOTE above classify()) so a report can tell "named a
// different real colour" apart from "reached for an everyday word" without
// re-deriving it by hand — measured, 5 of 5 recorded colour disagreements in
// this corpus are the second kind, none the first.
export const COLORS = {
  crimson: [220, 20, 60],
  teal: [0, 128, 128],
  goldenrod: [218, 165, 32],
  indigo: [75, 0, 130],
};

// COUNT range the generator draws from — named here rather than left as
// literals in generateTestImage() so KEY_SPACE below (and anything else
// that wants the true odds) is derived, not typed (T-012: "1-in-45" was
// typed once and never checked against COLORS or this range, and was wrong
// from the commit that introduced it).
// T-050: kept at 3-9 (28-combination key space) rather than narrowed to
// dodge the harder counts — measured live, one provider went 0/3 at
// truth.count=9 and 3/3 at truth.count=4 with no code change, and the
// recorded corpus's own count-stratified rate (scripts/shape-audit.mjs)
// shows the same shape: 3-5 at 90%, 6-9 at 73-77%. Narrowing to e.g. 3-6
// would shrink KEY_SPACE to 4x4=16, weakening the "nothing an LLM could
// guess its way into" arrival claim this probe exists to make — COUNT's
// whole job is being hard to fake, not easy to pass. The problem this
// ticket found was READABILITY (a rate reported with no stimulus attached
// reads as more general than it is), not DIFFICULTY, and shape-audit.mjs's
// per-count table is what actually fixes that: the mixture-over-difficulty
// is now visible per stratum instead of blended into one number. Revisit
// the range itself only if a future finding is about difficulty, not about
// the rate hiding what it was measured on.
export const MIN_COUNT = 3;
export const COUNT_RANGE = 7; // draws MIN_COUNT .. MIN_COUNT + COUNT_RANGE - 1

const KEY_SPACE = {
  countChoices: COUNT_RANGE,
  colorChoices: Object.keys(COLORS).length,
  total: COUNT_RANGE * Object.keys(COLORS).length,
};

// T-026: square/gap were locals inside renderPng, invisible to the one call
// site (generateTestImage) that picks the canvas size — so nothing ever
// checked whether MIN_COUNT+COUNT_RANGE-1 squares actually fit the 900px
// literal there. They didn't: count=9 needs 960px, and the 60px overflow
// was drawn anyway, silently clipping the first and last square into two
// 50x80 bars on every count=9 fixture ever generated (6 of 6, measured by
// decoding every fixture on disk — see scripts/fixture-audit.mjs). Hoisted
// to module scope and exported so the canvas width below, renderPng itself,
// and anything that wants to verify a fixture (fixture-audit.mjs,
// tests/renderPng.test.js) all compute from the SAME numbers instead of
// three separately-typed copies.
export const SQUARE = 80;
export const GAP = 30;
const MAX_COUNT = MIN_COUNT + COUNT_RANGE - 1;
const CANVAS_MARGIN = 25; // clear space each side, outside the widest layout
export const CANVAS_WIDTH =
  MAX_COUNT * SQUARE + (MAX_COUNT - 1) * GAP + CANVAS_MARGIN * 2;
export const CANVAS_HEIGHT = 400;

// --- Minimal PNG encoder: raw RGB buffer -> .png bytes, no dependencies. ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** width x height white canvas with `count` solid squares of `rgb` in a row. */
export function renderPng(width, height, count, rgb) {
  const px = Buffer.alloc(width * height * 3, 255); // white background
  const totalW = count * SQUARE + (count - 1) * GAP;
  // T-026: refuse to draw a layout that doesn't fit, rather than silently
  // clipping it — this is exactly how count=9 came to render as 7 full
  // squares and 2 clipped 50x80 bars on every count=9 fixture ever recorded.
  if (totalW > width) {
    throw new Error(
      `renderPng: count=${count} needs totalW=${count}*${SQUARE} + ${count - 1}*${GAP} = ${totalW}px, ` +
        `which overflows the ${width}px canvas by ${totalW - width}px`,
    );
  }
  const startX = Math.round((width - totalW) / 2);
  const y0 = Math.round((height - SQUARE) / 2);
  for (let i = 0; i < count; i++) {
    const x0 = startX + i * (SQUARE + GAP);
    for (let y = y0; y < y0 + SQUARE; y++) {
      for (let x = x0; x < x0 + SQUARE; x++) {
        const idx = (y * width + x) * 3;
        px[idx] = rgb[0];
        px[idx + 1] = rgb[1];
        px[idx + 2] = rgb[2];
      }
    }
  }

  // Raw scanlines, each prefixed with filter-type byte 0 (None).
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idatData = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseArgs(argv) {
  const out = {
    endpoint: "ask",
    baseUrl: process.env.VISION_PROBE_BASE_URL || "http://localhost:3333",
    providers: null,
    timeoutMs: 300000,
    // T-041: MUST start with "API Turn" (src/routes/ask/executor/prompts.js's
    // isApiTurn guard) — a label that doesn't was slipping every deepseek/
    // gemini/copilot probe turn a provider-constraint string (the tool-call
    // FORMAT REQUIREMENT block) that this probe never wanted, and deepseek
    // was echoing it back as its whole reply.
    label: "API Turn: vision-probe",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--endpoint") out.endpoint = argv[++i];
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--providers")
      out.providers = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--break") out.breakProvider = argv[++i];
    else if (a === "--image") out.image = argv[++i];
    else if (a === "--count") out.count = Number(argv[++i]);
    else if (a === "--color") out.color = argv[++i];
    else if (a === "--out") out.outPath = argv[++i];
    // T-072: the blind arm — sends the probe's own buildPrompt() with NO
    // `images` key at all, not an empty array. No code in this tree could
    // take this reading before now (askProvider() below always attaches an
    // image); this is the tool the board runs, not a bespoke evidence
    // script, so the next person can re-take the measurement without
    // re-deriving the request shape from scratch.
    else if (a === "--blind") out.blind = true;
    // T-053 review: a deliberate evidence-break test's own report needs to
    // be self-identifying as a plant to any reader OR script, not only to a
    // human who happens to read the filename — a naturally-occurring
    // refutation and a planted one look identical in a tally that reads
    // `imageAttached`/`raw` alone. `plantedBreak` is a required, non-empty
    // description (what was broken, and how) rather than a bare boolean, so
    // the row explains itself without a separate note.
    else if (a === "--planted-break") out.plantedBreak = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (!out.providers) out.providers = ALL_PROVIDERS;
  return out;
}

// T-055: main() only ever recognised THREE stimulus forms as pinned —
// --image+--count+--color (reuse a file) and --count+--color alone (T-050,
// render the pin fresh) — and silently fell through to a RANDOM draw for
// every other combination, including a lone --count, a lone --color, or
// --image with no truth to grade it against at all. The run still
// succeeded, the JSON was still well-formed, and the only trace was that
// `truth.count`/`truth.color` were not what was typed — exactly the field
// an operator who believes they pinned the stimulus has no reason to
// re-read. Extracted as its own function (not inlined in main()) so the
// rule is unit-testable without mocking the whole CLI.
export function validateStimulusArgs({
  image,
  count,
  color,
  blind,
  endpoint,
} = {}) {
  const hasCount = count !== undefined;
  const hasColor = color !== undefined;
  const hasImage = image !== undefined;
  // T-072: --blind sends no image at all — a --count/--color/--image
  // alongside it would name a picture that is never actually rendered or
  // sent, reading as pinned when the whole point of this arm is that
  // nothing was drawn. --endpoint image-ask has no request shape that
  // omits an image (it always attaches imagePath), so it cannot express
  // "blind" and is rejected rather than silently sending an image anyway.
  if (blind && (hasCount || hasColor || hasImage)) {
    throw new Error(
      "--blind sends no image at all — it cannot be combined with " +
        "--count/--color/--image, which would name a picture nothing " +
        "actually renders or sends.",
    );
  }
  if (blind && endpoint === "image-ask") {
    throw new Error(
      "--blind is not supported with --endpoint image-ask — that endpoint " +
        "always attaches imagePath, so there is no request shape that omits " +
        "an image.",
    );
  }
  if (hasCount !== hasColor) {
    throw new Error(
      "--count and --color must be given together (both, or neither) — " +
        "a lone one used to fall through to a silent random draw instead " +
        "of being rejected (T-055).",
    );
  }
  if (hasImage && !hasCount) {
    throw new Error(
      "--image requires --count and --color too — there is nothing to " +
        "grade the picture against otherwise, and this used to fall " +
        "through to a silent random draw (T-055).",
    );
  }
  // T-057: hasCount above only checks PRESENCE — `--count nine` parses to
  // NaN (parseArgs' `Number(argv[++i])`) and `--count 0`/`--count 99` parse
  // fine but are outside the range generateTestImage() actually draws from.
  // All three are `!== undefined`, so they used to pass this function, then
  // fail the `opts.count &&` truthiness check in main()'s pinned branch
  // (NaN and 0 are falsy; 99 is not) and fall through to the SAME silent
  // random draw T-055 closed for a lone flag — a malformed VALUE reopening
  // the hole T-055 closed for a missing one. Bounds come from MIN_COUNT/
  // MAX_COUNT, not a second "3 to 9" typed here.
  if (
    hasCount &&
    (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT)
  ) {
    throw new Error(
      `--count must be an integer from ${MIN_COUNT} to ${MAX_COUNT} — got ` +
        `${count}, which used to fall through to a silent random draw ` +
        `instead of being rejected (T-057).`,
    );
  }
  // T-057 clause 2/3: was already a check for this in main()'s pinned
  // branch, but only reachable once hasCount is truthy — moved here so a
  // caller gets the SAME rejection whichever way it fails, at the same
  // point (before generateTestImage's console output starts), and so this
  // is the one place that knows "valid colour" instead of two. COLORS is
  // the same object the prompt itself lists its palette from (buildPrompt).
  if (hasColor && !COLORS[color]) {
    throw new Error(
      `--color ${color} is not one of: ${Object.keys(COLORS).join(", ")}`,
    );
  }
}

/** Fresh PNG fixture: `count` (3-9) solid squares in a row, colour named. */
async function generateTestImage() {
  const count = MIN_COUNT + Math.floor(Math.random() * COUNT_RANGE);
  const colorNames = Object.keys(COLORS);
  const color = colorNames[Math.floor(Math.random() * colorNames.length)];
  const png = renderPng(CANVAS_WIDTH, CANVAS_HEIGHT, count, COLORS[color]);

  const outDir = join(REPO_ROOT, "reports", "vision-probe");
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `probe-${Date.now()}.png`);
  await writeFile(path, png);
  return { path, count, color };
}

function buildPrompt(truth) {
  const palette = Object.keys(COLORS).join(", ");
  return (
    `Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, ` +
    `no other text:\n\n` +
    `SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest ` +
    `match from exactly this list: ${palette}>\n\n` +
    `...or reply with EXACTLY this if you cannot see any image at all:\n\n` +
    `SEES=no`
  );
}

/**
 * classify() grades TWO different conjuncts and they are not the same kind
 * of test (T-012). COUNT is nowhere in the prompt — the arrival test this
 * probe exists to be, 1-in-7 by chance. COLOR's four legal answers are
 * printed in the prompt verbatim ("pick the closest match from exactly this
 * list: ..."), so it is a closed-vocabulary compliance test, 1-in-4 by
 * chance, and a "wrong" colour there often means the model saw the right
 * thing and reached for an everyday word instead of the prompt's specific
 * one (measured: three independent providers called one image's goldenrod
 * squares "yellow", all three having counted its squares correctly).
 *
 * So a count-right/colour-off-list reply is its own outcome — COUNT_ONLY —
 * and is NOT "the model saw *something* and was confidently mistaken about
 * it", which is what WRONG means and COUNT_ONLY must never be folded into,
 * on pain of a grader that under-reports arrival exactly when this ticket's
 * board is inclined to believe that story anyway.
 *
 * READER-FACING NOTE (T-086), for anyone reading a raw run-file's JSON
 * rather than this source: a structured reply (PASS / COUNT_ONLY / WRONG)
 * always carries `colorOk` (did the stated word match truth.color exactly)
 * AND `onList` (is the stated word one of COLORS' own four names at all).
 * The two bits together tell apart the disagreement that colorOk alone
 * cannot: colorOk=false + onList=true means the model named a DIFFERENT
 * real palette colour — a genuine miss. colorOk=false + onList=false means
 * it reached for an everyday word not in our four (measured: 5 of 5
 * recorded colorOk=false rows in this corpus have been this second kind,
 * none the first — see the deferral note above COLORS for the numbers).
 * `onList` is mechanical (Object.keys(COLORS)), never a hand-typed synonym
 * list; it does not attempt to resolve an off-list word to its nearest
 * palette member by colour distance — that refinement was scoped out of
 * T-086, not built and silently skipped.
 */
// T-025: exported so ia-grade.mjs (and anything else that needs to know
// whether a recorded reply is a prompt echo) decides it from the SAME code
// this probe grades with, instead of carrying a second, independently
// hand-typed pattern that can drift from this one.
export function classify(replyText, truth) {
  const text = (replyText || "").trim();

  // Prompt-echo MUST be checked first: the prompt's own text contains the
  // literal string "SEES=no" (in its "...or reply with EXACTLY this" clause),
  // so an echoed prompt matches the SEES_NO regex below and would otherwise
  // be misclassified as an honest "I see nothing" answer instead of the
  // turn having malfunctioned and reflected the prompt back unread.
  if (/Look at the attached image ONLY/i.test(text) && text.length > 80) {
    return { shape: "ECHO" };
  }

  // A STRUCTURED answer is checked BEFORE the bare SEES=no test, and must
  // win when both are present (T-012). The prompt's fallback clause is not
  // the only way "SEES=no" can appear in a reply that also contains a
  // complete, correct answer — a model hedging around its own answer
  // ("...so not SEES=no. SEES=yes COUNT=3 COLOR=goldenrod") would otherwise
  // be graded as reporting no image at all. Checking structure first means
  // a real answer is graded as one regardless of what else is in the reply.
  const m = text.match(
    /SEES\s*=\s*yes[\s\S]*?COUNT\s*=\s*(\d+)[\s\S]*?COLOR\s*=\s*([a-zA-Z]+)/i,
  );
  if (m) {
    const [, count, color] = m;
    const countOk = Number(count) === truth.count;
    const colorOk = color.toLowerCase() === truth.color.toLowerCase();
    // T-086: colorOk=false has always collapsed two different disagreements
    // into one bit — "named a different member of OUR palette" (a genuine
    // miss: the model saw a colour and named the wrong one) versus "named a
    // word that isn't one of our four at all" (a vocabulary miss: measured,
    // 5 of 5 recorded colorOk=false rows were this kind, none the other —
    // see the READER-FACING NOTE below classify() for how to tell them
    // apart in a raw report). onList is mechanical, derived from COLORS
    // (never a hand-typed synonym list — that guess was already refused
    // once, T-012), and — same rule T-076 set for outOfRange — always
    // present, true or false, never omitted.
    const onList = Object.prototype.hasOwnProperty.call(
      COLORS,
      color.toLowerCase(),
    );
    if (countOk && colorOk) return { shape: "PASS", countOk, colorOk, onList };
    if (countOk) {
      return {
        shape: "COUNT_ONLY",
        countOk,
        colorOk,
        onList,
        detail: onList
          ? `COUNT=${count} correct, COLOR=${color} is a different listed colour (expected ${truth.color})`
          : `COUNT=${count} correct, COLOR=${color} not on the list (expected ${truth.color})`,
      };
    }
    // T-076: a WRONG count outside MIN_COUNT..MAX_COUNT names a picture
    // the generator could never have drawn — strictly stronger than "got
    // it wrong", since it rules out "miscounted a real picture" entirely.
    // Derived from the same two constants validateStimulusArgs already
    // enforces on the STIMULUS (MIN_COUNT/COUNT_RANGE below), not a second
    // "3 to 9" typed here — that duplication is exactly the shape this
    // ticket is about, one layer over.
    //
    // THE LIMIT, which must travel with this field: out of range proves
    // the reply is NOT a reading of any drawable picture. In range proves
    // NOTHING — 52.0% of this corpus's recorded truths fall at count 4 or
    // 5, so a fabricated small number is likely to land inside the range
    // and be invisible to this check. An outOfRange tally of zero is
    // evidence nobody fabricated CONSPICUOUSLY, not evidence nobody
    // fabricated.
    return {
      shape: "WRONG",
      countOk,
      colorOk,
      onList,
      // Always present, true or false — never omitted. This board has
      // three tickets (T-038, T-046, T-052) about absence-of-a-field
      // silently reading as false; an omitted outOfRange would repeat
      // that shape for a field whose whole point is "checked, not just
      // assumed".
      outOfRange: Number(count) < MIN_COUNT || Number(count) > MAX_COUNT,
      detail:
        `got COUNT=${count} COLOR=${color}, expected COUNT=${truth.count} COLOR=${truth.color}` +
        (colorOk
          ? ""
          : onList
            ? " (COLOR is a different listed colour)"
            : " (COLOR is not on the list)"),
    };
  }

  const seesNo = /\bSEES\s*=\s*no\b/i.test(text);
  if (seesNo) return { shape: "SEES_NO" };

  if (!text) return { shape: "NO_ANSWER", detail: "empty response" };
  return { shape: "NO_ANSWER", detail: text.slice(0, 200) };
}

async function askProvider(opts, providerId, imagePath, truth) {
  const prompt = buildPrompt(truth);
  const started = Date.now();

  let body;
  let url;
  if (opts.endpoint === "image-ask") {
    url = `${opts.baseUrl}/api/image-ask`;
    body = { provider: providerId, prompt, imagePath, label: opts.label };
  } else {
    const imageBuf = await (
      await import("node:fs/promises")
    ).readFile(imagePath);
    url = `${opts.baseUrl}/api/ask`;
    body = {
      providers: [providerId],
      prompt,
      images: [`data:image/png;base64,${imageBuf.toString("base64")}`],
      label: opts.label,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        providerId,
        elapsedMs,
        shape: "ERROR",
        detail: `HTTP ${res.status}: ${json?.error || "(no error field)"}`,
        imageAttached: json?.imageAttached,
        imageAttachedCause: json?.imageAttachedCause,
        imageAttachedEvidence: json?.imageAttachedEvidence,
      };
    }
    // T-027: `shape` (via ...cls below) is a MEASUREMENT TAKEN ONCE, BY
    // WHATEVER classify() SAYS TODAY — same reasoning as gradingProvenance()
    // above for why old runs are never backfilled with a new grading: a
    // classifier fix (T-012, T-025) does not reach back and correct labels
    // already written, so `shape` on disk can disagree with what HEAD's own
    // classify() would say about the same `raw` right now. `raw` is the
    // evidence and never changes; `shape` is this run's opinion of it at the
    // time. A reader who wants the CURRENT classification recomputes it from
    // `raw` — ia-grade.mjs already does exactly that for its own grading,
    // and scripts/shape-audit.mjs reports every row where the two disagree.
    const cls = classify(json.response, truth);
    return {
      providerId,
      elapsedMs,
      ...cls,
      imageAttached: json.imageAttached,
      imageAttachedCause: json.imageAttachedCause,
      // T-053: the "true" counterpart to imageAttachedCause — which
      // evidence alternative matched, requireGrowth/grew, elapsedMs,
      // strategy. Present only when imageAttached is true.
      imageAttachedEvidence: json.imageAttachedEvidence,
      // T-073: deepseek-only today (mode.js's selectDeepSeekVisionMode) —
      // "already-on" | "clicked-and-confirmed-on" | "not-confirmed",
      // undefined (dropped by JSON.stringify) for every other provider.
      visionModeVerdict: json.visionModeVerdict,
      warning: json.warning,
      raw: json.response,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      providerId,
      elapsedMs,
      shape: "ERROR",
      detail: err.name === "AbortError" ? "timeout" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// T-072: classify() needs a `truth` to grade a structured answer's
// COUNT/COLOR against — a blind turn has no picture, so there is nothing
// real to grade. A sentinel truth ({count: null, color: ""}) makes
// countOk/colorOk always false without ever throwing (a real stated
// count is never null, a real stated colour is never the empty string),
// so this is used ONLY to reuse classify()'s shape detection (ECHO/
// SEES_NO/NO_ANSWER/structured), never its correctness verdict. `stated`
// is the number worth reporting for a blind turn — whether a count was
// said AT ALL, not whether it happened to be right — extracted the same
// way the redo's own probe script did, with the same ECHO exception (an
// echoed prompt contains "COUNT=<how many..." verbatim and would
// otherwise misreport a non-answer as "stated <garbage>").
export function classifyBlind(replyText) {
  const shape = classify(replyText, { count: null, color: "" }).shape;
  const m =
    shape === "ECHO" ? null : /COUNT\s*=\s*(\d+)/i.exec(replyText ?? "");
  return { shape, stated: m ? Number(m[1]) : null };
}

async function askProviderBlind(opts, providerId) {
  const prompt = buildPrompt();
  const started = Date.now();
  const url = `${opts.baseUrl}/api/ask`;
  const body = {
    providers: [providerId],
    prompt,
    label: opts.label,
    // Deliberately NO `images` key — not an empty array — this is the
    // whole experiment: the server must take no upload path at all.
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        providerId,
        elapsedMs,
        shape: "ERROR",
        detail: `HTTP ${res.status}: ${json?.error || "(no error field)"}`,
        imageAttached: json?.imageAttached,
      };
    }
    const { shape, stated } = classifyBlind(json.response);
    return {
      providerId,
      elapsedMs,
      shape,
      stated,
      // Expected to be undefined on every blind turn — the server takes
      // no upload path at all with no `images` key sent. Recorded rather
      // than assumed, so a future regression that DOES set it here (a
      // sign something upstream started treating a blind turn as an
      // image turn) is visible on the row, not silently dropped.
      imageAttached: json.imageAttached,
      raw: json.response,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      providerId,
      elapsedMs,
      shape: "ERROR",
      detail: err.name === "AbortError" ? "timeout" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// T-090: pulled out of runBlind() so the report SHAPE is testable without a
// live bridge or provider calls (clause 4: no live turns for a one-line
// rule) — same reasoning as classify()/validateStimulusArgs() being pulled
// out elsewhere in this file. Exercises the exact object runBlind() writes
// to disk, not a duplicate literal a test could drift from.
export function buildBlindReport(provenance, opts, results) {
  return {
    ...provenance,
    // T-072: THE field that marks a blind run — read by ia-grade.mjs's
    // section 5, not a filename substring (nothing greps filenames).
    // No `truth` and no `imagePath`/`fixtureSha256`: nothing was
    // rendered or sent, so there is nothing real those fields could
    // name without reading as a picture that does not exist.
    blind: true,
    // T-090: runBlind() returns to main() before the pinned/drawn
    // dispatch in main() ever runs, so a blind report written AFTER
    // T-084 landed stimulusSource would otherwise carry no such field at
    // all — indistinguishable, by the reader rule documented in main(),
    // from a report written BEFORE the field existed. Written explicitly
    // here so the same read (`report.stimulusSource ?? "unrecorded
    // (pre-T-084)"`) correctly names all four populations — pinned,
    // drawn, blind, and pre-T-084 — without a reader needing to check
    // `blind` first.
    stimulusSource: "blind",
    endpoint: opts.endpoint,
    results,
  };
}

async function runBlind(opts) {
  console.log(
    `Blind arm (T-072): sending the probe's own prompt with NO images key ` +
      `at all to ${opts.providers.length} provider(s)...\n`,
  );

  const results = [];
  for (const providerId of opts.providers) {
    process.stdout.write(`${providerId.padEnd(12)} ... `);
    const r = await askProviderBlind(opts, providerId);
    results.push(r);
    const secs = (r.elapsedMs / 1000).toFixed(0) + "s";
    const stated = r.stated === undefined ? "" : `  stated=${r.stated}`;
    console.log(
      `${r.shape.padEnd(10)} ${secs.padStart(5)}  imageAttached=${r.imageAttached}${stated}  ${r.detail || ""}`,
    );
  }

  const EXCLUDED = new Set(["ECHO", "ERROR", "NO_ANSWER"]);
  const informative = results.filter((r) => !EXCLUDED.has(r.shape));
  const guessed = informative.filter((r) => r.stated !== null);
  const refused = informative.filter((r) => r.stated === null);
  console.log(
    `\nblind turns sent ${results.length}   informative (not ECHO/ERROR/NO_ANSWER) ${informative.length}   ` +
      `refused (stated no count) ${refused.length}   STATED A COUNT ${guessed.length}`,
  );
  if (guessed.length) {
    console.log(
      `\n!!! PROVIDER(S) STATED A COUNT WHILE BLIND — THIS IS THE RESULT:`,
    );
    for (const r of guessed) {
      console.log(`    ${r.providerId}  stated=${r.stated}  :: ${r.raw}`);
    }
  }

  const outDir = join(REPO_ROOT, "reports", "vision-probe");
  await mkdir(outDir, { recursive: true });
  const outPath = opts.outPath || join(outDir, `blind-${Date.now()}.json`);
  const provenance = await gradingProvenance(opts.baseUrl);
  await writeFile(
    outPath,
    JSON.stringify(buildBlindReport(provenance, opts, results), null, 2),
  );
  console.log(`\nFull results written to ${outPath}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "Usage: node scripts/vision-probe.mjs [--endpoint ask|image-ask] [--providers a,b,c] " +
        "[--base-url url] [--timeout-ms N] " +
        "[--count N --color name [--image path]] [--out path]\n" +
        "  --count N --color name alone (T-050) renders that exact fixture fresh " +
        "(renderPng is a pure function of the pair) — add --image path to reuse an " +
        "already-rendered file instead of re-rendering.\n" +
        "  --count/--color must be given together (T-055) — a lone one, or " +
        "--image with neither, is rejected rather than silently randomised.\n" +
        "  --blind (T-072) sends the SAME prompt with NO image at all — no --count/" +
        "--color/--image/--break, and endpoint must be the default ask (there is no " +
        "picture to upload for --endpoint image-ask to attach). Measures whether a " +
        "provider ever states a COUNT with nothing attached — the arrival test's own " +
        "prior, unmeasured until this flag existed.",
    );
    return;
  }
  // T-055: fail fast, before generating anything or touching a provider.
  validateStimulusArgs(opts);

  if (opts.blind) {
    return await runBlind(opts);
  }

  if (opts.breakProvider) {
    console.log(
      `--break does not edit code or start a server — see the file header for why.\n` +
        `To demonstrate ${opts.breakProvider} failing on purpose:\n\n` +
        `  1. Edit its attach-button selector (src/ai/generic/specs.js for a generic\n` +
        `     provider, or the bespoke uploadFileTo* selector otherwise) to something\n` +
        `     that cannot match, e.g. "input[type='file'].NONEXISTENT-PROBE-BREAK".\n` +
        `  2. Start a bridge instance on a spare port (T-060: the live server's\n` +
        `     own process is not killed by this — see the file header for what a\n` +
        `     spare-port launch still touches):\n` +
        `       PORT=3334 node --env-file=.env src/index.js\n` +
        `  3. Re-run this probe against just that instance and provider:\n` +
        `       node scripts/vision-probe.mjs --base-url http://localhost:3334 --providers ${opts.breakProvider}\n` +
        `  4. Revert the selector edit and stop the spare instance.\n`,
    );
    return;
  }

  // T-084: which of the three branches below ran is exactly "was this
  // stimulus PINNED (the caller named count/colour, whether reusing an
  // --image or rendering fresh) or DRAWN (generateTestImage's own random
  // choice)" — the corpus mixes both with opposite selection pressure (a
  // pinned run is deliberately aimed at a count already known to fail) and
  // no prior report field said which was which. Recorded, not backfilled
  // onto the 119 reports that predate this field (T-074's precedent: an old
  // report stays visibly WITHOUT the field rather than acquiring a guessed
  // one).
  //
  // T-090: THIS is not the only place stimulusSource is written — runBlind()
  // (above, returned into from main() before this function's own dispatch
  // ever runs) writes its own literal "blind" onto every blind report, for
  // exactly the same reason: without it, a blind report written AFTER this
  // field existed would read back indistinguishable from one written
  // before it. So a reader tells all FOUR populations apart with one read,
  // no special-casing `blind` first: `report.stimulusSource ??
  // "unrecorded (pre-T-084)"` — "pinned", "drawn", "blind", or the
  // pre-field fallback.
  let imagePath, count, color, stimulusSource;
  if (opts.image && opts.count && opts.color) {
    // Reuse a fixture generated by an earlier invocation — lets several
    // single-provider runs (launched in parallel, one process each, to stay
    // under a single run's wall-clock budget) all be asked about the exact
    // same picture, as one measurement rather than several.
    ({ image: imagePath, count, color } = opts);
    stimulusSource = "pinned";
    console.log(
      `Using existing test image (endpoint: /api/${opts.endpoint})...`,
    );
  } else if (opts.count && opts.color) {
    // T-050: renderPng is a PURE function of (count, colour) — a probe's own
    // sha256 comparison found today's fresh render byte-identical to
    // fixtures committed on different days for the same (count, colour).
    // So (count, colour) already names a fixture exactly; a caller wanting
    // to hold the stimulus still across two runs (or match an old sweep's
    // exact picture) does not need to keep a PNG alive between them — just
    // pass the same --count/--color and this renders that same picture
    // fresh, no --image required.
    count = opts.count;
    color = opts.color;
    // T-057: count and color are both already validated by
    // validateStimulusArgs (called earlier in main(), before any of this
    // branching) — no second check needed here.
    const png = renderPng(CANVAS_WIDTH, CANVAS_HEIGHT, count, COLORS[color]);
    const outDir = join(REPO_ROOT, "reports", "vision-probe");
    await mkdir(outDir, { recursive: true });
    imagePath = join(outDir, `probe-${Date.now()}.png`);
    await writeFile(imagePath, png);
    stimulusSource = "pinned";
    console.log(
      `Rendering pinned test image (count=${count} color=${color}, endpoint: /api/${opts.endpoint})...`,
    );
  } else {
    console.log(`Generating test image (endpoint: /api/${opts.endpoint})...`);
    ({ path: imagePath, count, color } = await generateTestImage());
    stimulusSource = "drawn";
  }
  console.log(`  ground truth: COUNT=${count} COLOR=${color}`);
  console.log(`  image: ${imagePath}`);
  console.log(
    `  key space: COUNT is 1-in-${KEY_SPACE.countChoices} (not in the prompt) x ` +
      `COLOR is 1-in-${KEY_SPACE.colorChoices} (printed in the prompt) = ${KEY_SPACE.total} combined\n`,
  );

  const results = [];
  for (const providerId of opts.providers) {
    process.stdout.write(`${providerId.padEnd(12)} ... `);
    const r = await askProvider(opts, providerId, imagePath, { count, color });
    results.push(r);
    const secs = (r.elapsedMs / 1000).toFixed(0) + "s";
    const attached =
      r.imageAttached === undefined
        ? "?"
        : r.imageAttached
          ? "attached"
          : `NOT attached (${r.imageAttachedCause || "cause absent"})`;
    const halves =
      r.countOk !== undefined
        ? `COUNT=${r.countOk ? "ok" : "NO"} COLOR=${r.colorOk ? "ok" : "NO"}  `
        : "";
    console.log(
      `${r.shape.padEnd(10)} ${secs.padStart(5)}  imageAttached=${attached}  ${halves}${r.detail || ""}`,
    );
  }

  const counts = results.reduce((acc, r) => {
    acc[r.shape] = (acc[r.shape] || 0) + 1;
    return acc;
  }, {});

  // COUNT / COLOR / PASS are reported out of the STRUCTURED subset — replies
  // that carried a countOk/colorOk verdict at all (PASS, COUNT_ONLY, WRONG)
  // — not out of every result, because a SEES_NO or an ERROR has no verdict
  // on either half to report (T-012: this mirrors the ticket's own
  // reclassify script, which grades "structured SEES=yes answers" as its
  // own denominator rather than the full run).
  const structured = results.filter((r) => r.countOk !== undefined);
  const countRight = structured.filter((r) => r.countOk).length;
  const colorRight = structured.filter((r) => r.colorOk).length;
  const passCount = structured.filter((r) => r.countOk && r.colorOk).length;

  // T-050: the COUNT rate is a rate ON THIS RUN'S OWN STIMULUS, not a
  // provider-general accuracy figure — measured live (this ticket's own
  // paired test) to swing 100 points for the same provider between
  // truth.count=9 (0/3) and truth.count=4 (3/3) with no code change at all.
  // A rate printed without the count it was measured at reads as more
  // general than it is; stating it here costs one field.
  console.log(
    `\nCOUNT right ${countRight}/${structured.length}   ` +
      `COLOR right ${colorRight}/${structured.length}   ` +
      `PASS ${passCount}/${structured.length}   ` +
      `at truth.count=${count} truth.color=${color}   ` +
      `(${results.length} total: ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") +
      ")",
  );

  const outDir = join(REPO_ROOT, "reports", "vision-probe");
  await mkdir(outDir, { recursive: true });
  const outPath = opts.outPath || join(outDir, `run-${Date.now()}.json`);
  const provenance = await gradingProvenance(opts.baseUrl);
  // T-049/T-052: warn loudly and continue, not refuse — chosen over an
  // override flag because this tool's whole purpose is diagnosis, and
  // refusing to run against a bridge whose staleness you are trying to SEE
  // (e.g. "does the old code still misbehave this way") would make the tool
  // useless for exactly the situation that most needs it. Every other
  // provenance field in this file (dirtyPaths, the absent-field convention
  // T-012 set up) already follows "record the truth, let the reader decide"
  // over "refuse" — consistent with that, and the field is now impossible
  // to miss: console AND every report, every time, not an opt-in check.
  //
  // T-052 chose to keep firing a banner on `serverStale`, rather than
  // suppressing it for the "stale-ambiguous" case, and to say WHICH
  // situation the run is actually in (acceptance clause 3's second option)
  // instead: `classifyServerProvenance` cannot prove the ambiguous case is
  // actually fine — it only knows the tree WAS dirty at startup, not that
  // the commit that followed captured exactly those edits and nothing else
  // — so collapsing it to silence would let a genuinely stale run through
  // on a guess. A banner that is right about being uncertain is worth more
  // than one that is confidently wrong in either direction.
  if (provenance.serverProvenance === "stale-confirmed") {
    console.log(
      `\n${"!".repeat(70)}\n` +
        `STALE BRIDGE: this run's results came from a server process\n` +
        `running commit ${provenance.serverLoadedCommit}, not this checkout's\n` +
        `HEAD (${provenance.bridgeCommit}). Node does not hot-reload — restart\n` +
        `the bridge before trusting this run as a live verification of\n` +
        `anything committed after ${provenance.serverLoadedCommit}.\n` +
        `${"!".repeat(70)}\n`,
    );
  } else if (provenance.serverProvenance === "stale-unmeasured-tree") {
    console.log(
      `\n${"!".repeat(70)}\n` +
        `STALE BRIDGE: this run's results came from a server process\n` +
        `running commit ${provenance.serverLoadedCommit}, not this checkout's\n` +
        `HEAD (${provenance.bridgeCommit}). Whether that server started from\n` +
        `a dirty tree could not be measured, so this may be a same-code\n` +
        `restart under an old sha rather than genuinely old code — restart\n` +
        `the bridge to be sure before trusting this run.\n` +
        `${"!".repeat(70)}\n`,
    );
  } else if (provenance.serverProvenance === "stale-ambiguous") {
    console.log(
      `\n${"!".repeat(70)}\n` +
        `POSSIBLY-STALE BRIDGE (ambiguous): server loadedCommit\n` +
        `(${provenance.serverLoadedCommit}) differs from this checkout's HEAD\n` +
        `(${provenance.bridgeCommit}), BUT the server's tree was dirty at ITS\n` +
        `OWN startup — the ordinary edit-restart-commit loop. This may mean\n` +
        `the server is running exactly the code now committed at HEAD (the\n` +
        `edits it loaded were committed afterward), not old code. Cannot be\n` +
        `told apart from a genuinely stale bridge without checking by hand\n` +
        `(e.g. diff ${provenance.serverLoadedCommit}..${provenance.bridgeCommit}\n` +
        `against what you edited) — treat this run as unverified, not as\n` +
        `definitely wrong.\n` +
        `${"!".repeat(70)}\n`,
    );
  } else if (provenance.serverProvenance === "unverifiable") {
    console.log(
      `\n${"!".repeat(70)}\n` +
        `UNVERIFIABLE PROVENANCE: server loadedCommit matches this\n` +
        `checkout's HEAD (${provenance.bridgeCommit}), but the server's tree\n` +
        `was DIRTY AT ITS OWN STARTUP — it loaded whatever uncommitted edits\n` +
        `were on disk at that moment, which the matching sha does not\n` +
        `describe. If nothing has been committed since, this run may be\n` +
        `grading code that never made it into HEAD at all. Restart the\n` +
        `bridge from a clean, committed tree before trusting this run as a\n` +
        `verification of anything.\n` +
        `${"!".repeat(70)}\n`,
    );
  }
  if (opts.plantedBreak) {
    console.log(
      `\nPLANTED BREAK: ${opts.plantedBreak}\n` +
        `This run's results should NOT be read as naturally-occurring — ` +
        `check each result's imageAttachedEvidence.evidenceSelectorUsed ` +
        `for the selector actually in effect, not just this note.\n`,
    );
  }
  // T-074: the actual fixture image's own hash — full sha256, not
  // truncated, over the exact PNG bytes this run sent. This is the field
  // "same picture across two runs" actually needs; graderSha256 above
  // (this SCRIPT's own source) never answered that, despite reading like
  // it did. Unlike graderSha256, this DOES read as "same fixture" safely:
  // renderPng (below) is a pure function of (count, colour) — no
  // randomness in square placement — so two runs at the SAME pinned truth
  // genuinely do produce byte-identical PNGs (confirmed repeatedly on this
  // board's own corpus: T-050, T-048's five count=5/crimson runs, this
  // ticket's own count=4/crimson demonstration below, all one sha256 per
  // truth). What varies run to run is which truth gets drawn when it
  // ISN'T pinned (generateTestImage's own random count+colour draw), not
  // the rendering of a given truth.
  const fixtureSha256 = createHash("sha256")
    .update(await readFile(imagePath))
    .digest("hex");

  await writeFile(
    outPath,
    JSON.stringify(
      {
        ...provenance,
        fixtureSha256,
        ...(opts.plantedBreak ? { plantedBreak: opts.plantedBreak } : {}),
        endpoint: opts.endpoint,
        // T-084: "pinned" (the caller named count/colour) or "drawn"
        // (generateTestImage's own random choice) — see the comment above
        // where this is set, near the three-way branch that decides it.
        stimulusSource,
        truth: { count, color },
        // Repo-relative, not absolute — these files are tracked (T-017) and
        // this repo is public; an absolute path bakes the local username
        // into every recorded run.
        imagePath: relative(REPO_ROOT, imagePath),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull results written to ${outPath}`);
}

// T-025: guarded so `import { classify } from "./vision-probe.mjs"` (ia-grade.mjs)
// does not also fire off a live probe run against a bridge — main() only runs
// when this file is executed directly.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
