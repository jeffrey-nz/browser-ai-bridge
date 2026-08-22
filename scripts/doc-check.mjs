#!/usr/bin/env node
// doc-check.mjs — T-085. 0 of the 17 scripts committed under scripts/ were
// reachable via `npm run`, and 2 were named in any tracked .md file — the
// other 15 were only findable by listing the directory or by stumbling
// into a comment inside another script. That is a discoverability tax paid
// by whoever looks next (T-085's own goal section paid it twice in one
// hour, on a decoder that already existed).
//
// TWO BUCKETS. A script under scripts/ is either:
//   - a TOOL: reusable, reached for again across tickets, documented in
//     README.md's "Corpus & diagnostic scripts" section.
//   - a ONE-SHOT PROBE: an evidence-gathering script written for one
//     closed ticket's specific measurement, never meant to be re-run
//     generally. Not required to be documented anywhere.
//
// THE PREDICATE, mechanical, not prose: a script is a one-shot probe iff
// its own LINE 2 — the line immediately after the shebang, exactly, no
// earlier and no later — is `// @one-shot-probe ...`. Not a substring
// search anywhere in the header and not "any line starting with it"
// either; see the comment above isOneShot() below for why both of those
// were tried first and both produced false positives on this very file.
// (The obvious filename rule, "starts with t<digits>-", covers 8 of the
// 10 today; break-demo.mjs and extraction-break-demo.mjs are one-shot
// probes for closed tickets under names that don't match it — the marker
// covers both without carving out filename exceptions.) Everything else
// under scripts/ is bucket one BY DEFAULT — a new file added tomorrow with
// no marker is a tool the moment it exists, and this check will say so if
// nobody names it, rather than silently missing it the way a hardcoded
// list of today's count would.
//
// THE CHECK RUNS BOTH DIRECTIONS, HOLDS NO LIST OF ITS OWN (copied from
// mmg's test/cold-run.mjs --check):
//   A. every `scripts/<file>` reference in README.md's tool section names
//      a file that actually exists on disk (catches a stale doc entry —
//      renamed or deleted file, still documented)
//   B. every bucket-one script on disk (marker absent) is named somewhere
//      in that same README section (catches an undocumented new tool —
//      this ticket's own finding, restated so it cannot recur silently)
// Direction B is restricted to bucket one on purpose (T-085 clause 3): if
// one-shot probes had to be named too, the check would be permanently red
// under the ordinary flow of new closed-ticket scripts landing, and a
// permanently red check is one nobody reads.
//
// Usage: node scripts/doc-check.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");
const README_PATH = path.join(REPO_ROOT, "README.md");
const ONE_SHOT_MARKER = "@one-shot-probe";

export function listScriptFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(mjs|js)$/.test(f))
    .sort();
}

// SPECIFICALLY LINE 2 (the line right after the shebang) — not a
// substring search, and not "any line starting with the marker" either.
// Both were tried and both broke on this file's OWN header while planting
// clause 4's proof: a bare substring matched this file's prose ABOUT the
// marker; requiring a line to merely START with it still matched, because
// a wrapped prose sentence in the planted test file happened to break a
// line right before "@one-shot-probe" — a natural-language comment can
// wrap into looking like a marker line by accident, but it cannot land on
// a SPECIFIC line number by accident. Every real marked file has it as
// the complete line 2, placed there once, by this ticket — so checking
// that one exact position is both mechanical and immune to the two
// self-inflicted false positives found while testing this file against
// itself (see the hand-back for both failing runs).
export function isOneShot(dir, file) {
  const contents = fs.readFileSync(path.join(dir, file), "utf8");
  const lines = contents.split("\n");
  return (lines[1] ?? "").trim().startsWith(`// ${ONE_SHOT_MARKER}`);
}

// Every `scripts/<name>.mjs` or `scripts/<name>.js` substring in the
// README — not scoped to one section by heading, deliberately: a tool
// named ANYWHERE in the doc satisfies direction B, so moving prose around
// later cannot silently un-name a script this check already found.
export function namedInReadme(readmeText) {
  const matches = [...readmeText.matchAll(/scripts\/([\w.-]+\.(?:mjs|js))/g)];
  return new Set(matches.map((m) => m[1]));
}

export function runCheck(dir, readmeText) {
  const files = listScriptFiles(dir);
  const bucketOne = files.filter((f) => !isOneShot(dir, f));
  const oneShot = files.filter((f) => isOneShot(dir, f));
  const named = namedInReadme(readmeText);

  const staleReadmeNames = [...named].filter((n) => !files.includes(n));
  const undocumentedTools = bucketOne.filter((f) => !named.has(f));

  return {
    files,
    bucketOne,
    oneShot,
    named,
    staleReadmeNames,
    undocumentedTools,
    ok: staleReadmeNames.length === 0 && undocumentedTools.length === 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const readmeText = fs.readFileSync(README_PATH, "utf8");
  const result = runCheck(SCRIPTS_DIR, readmeText);

  for (const name of result.staleReadmeNames) {
    console.log(
      `FAIL (direction A): README.md names scripts/${name}, which does not exist on disk`,
    );
  }
  for (const f of result.undocumentedTools) {
    console.log(
      `FAIL (direction B): scripts/${f} is a tool (no ${ONE_SHOT_MARKER} marker) but is not named in README.md`,
    );
  }
  if (result.ok) {
    console.log(
      `doc-check: PASS — ${result.bucketOne.length} tool(s), ${result.oneShot.length} one-shot probe(s), all named where required.`,
    );
  }
  process.exitCode = result.ok ? 0 : 1;
}
