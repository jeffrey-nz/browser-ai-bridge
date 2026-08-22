#!/usr/bin/env node
"use strict";
// T-116: turns T-115's evidence/t115-unreached.cjs probe into a permanent
// gate. Resolution logic below is copied VERBATIM from that probe (same
// walk/resolve/edgesFrom functions, same regexes) — not a second parser
// written from scratch beside it, per this ticket's own clause 1.
// evidence/t115-unreached.cjs is left byte-for-byte unchanged (it is T-115's
// own quoted-from-ticket text, same precedent as T-108/T-112's committed
// probes); this file is the one that grows an allowlist and an exit code.
//
// L-001/L-028's own shape, named at every failure branch below rather than
// left implicit: a gate that can pass by having checked nothing (an empty
// module list, an unreadable entry point, a missing allowlist file) is
// indistinguishable from a gate that is actually clean, from the outside,
// unless it fails loudly in exactly those cases. Every exit path prints the
// denominator first, so a reader never has to infer whether the check ran
// from its own silence.
const fs = require("fs");
const path = require("path");

const ALLOWLIST_PATH = path.join(__dirname, "reachability-allowlist.json");

function computeReachability() {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const norm = (p) => p.split(path.sep).join("/");
  const all = [];
  // T-129: scripts/ is deliberately NOT walked here, and this comment is
  // that decision's record — the ticket found this exclusion looked like an
  // oversight because nothing said otherwise.
  //
  // This walker's whole model is a BFS from package.json's declared entry
  // points (exports/main/bin) — every src/ file is "reachable" because
  // SOMETHING imports it, transitively, from that one root. scripts/ files
  // are not imported from anywhere by design: each one is its own
  // independent CLI entry point, run directly (`node scripts/x.mjs`). Under
  // this walker's own model, applied to scripts/, every file would be an
  // entry point and 0 of them would ever fail — a rule that fails 0 of N is
  // not a gate.
  //
  // The next-best candidate — "reachable if package.json, ci.yml, or
  // another file statically imports it" — was tried and counted, not just
  // argued: of 23 scripts/ code files, 8 pass (referenced by a package.json
  // script entry, a same-directory import, or a tests/*.test.js import) and
  // 15 fail, BY NAME: attachment-diagnose.mjs, break-demo.mjs,
  // dom-diagnose.mjs, extraction-break-demo.mjs, fixture-audit.mjs,
  // generateCssColorTable.mjs, t022-qwen-probe.mjs, t023-kill-pages.mjs,
  // t023-list-pages.mjs, t031-growth-check.mjs, t034-growth-timing-check.mjs,
  // t035-kimi-failure-timing.mjs, t035-kimi-latency-check.mjs,
  // t036-kimi-plateau-check.mjs, t103-cdp-trace.mjs. Several of those 15 are
  // demonstrably alive, deliberately-manual tools with no importer BY
  // DESIGN (fixture-audit.mjs, generateCssColorTable.mjs — T-089's own
  // byte-reproducibility generator), indistinguishable under this rule from
  // an actually-spent t0NN-*.mjs probe. A rule that can't tell those apart
  // is not a gate either, whatever its pass/fail ratio looks like.
  //
  // A second, independent fragility: even the "passing" side isn't fully
  // trustworthy. scripts/provenance-census.mjs's real, working import of
  // scripts/ia-grade.mjs is a dynamic `await import(pathToFileURL(...).href)`
  // — invisible to this file's own edgesFrom() regex (which only matches a
  // literal quoted string immediately after from/import(/require(). It
  // happened not to change ia-grade.mjs's own pass/fail result here (it also
  // has tests/ importers), but a future scripts/ file reachable ONLY through
  // a dynamic import would silently read as unreferenced.
  //
  // Verdict: NO widening. Nothing here replaces a human occasionally reading
  // scripts/ and correlating the t0NN-*.mjs names against closed tickets —
  // stated plainly rather than left implicit, per this ticket's own clause 4.
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs)$/.test(e.name)) all.push(norm(p));
    }
  })("src");
  const aliases = Object.entries(pkg.imports || {});
  const resolve = (spec, fromFile) => {
    let base = null;
    if (spec.startsWith(".")) {
      base = norm(path.join(path.dirname(fromFile), spec));
    } else {
      for (const [k, v] of aliases) {
        if (k.endsWith("/*") && spec.startsWith(k.slice(0, -1))) {
          base = norm(path.join(v.replace("/*", ""), spec.slice(k.length - 1)));
          break;
        }
        if (k === spec) {
          base = norm(v.replace(/^\.\//, ""));
          break;
        }
      }
    }
    if (!base) return null;
    base = base.replace(/^\.\//, "");
    const tries = [
      base,
      base + ".js",
      base + ".mjs",
      base + ".cjs",
      base + "/index.js",
      base + "/index.mjs",
    ];
    for (const t of tries) if (all.includes(t)) return t;
    return null;
  };
  // T-116: a declared entry point that no longer resolves to a real file
  // (deleted, renamed, a typo in package.json) used to be silently DROPPED
  // here — the gate would just proceed with whatever subset of entry points
  // still existed, noticing nothing as long as at least one did. `unreadable`
  // collects every declared path that did NOT resolve, so the caller can
  // fail loudly on it instead of quietly narrowing the census's own start
  // set.
  // T-116 fix to the probe's own logic (disclosed per this ticket's clause
  // 1): the original walked `bin/` and added its files to `all` AFTER
  // calling `addEntry(pkg.bin)` — harmless there, since the probe only ever
  // checked "did SOMETHING end up in entries", but it means `pkg.bin`'s own
  // declared path could never resolve via `addEntry` and would always look
  // "unreadable" once this gate started checking that. Walking `bin/` first
  // makes the order match what a reader would expect: package.json's own
  // `bin` field should describe a real, already-present file, not one this
  // script itself adds moments later.
  if (fs.existsSync("bin")) {
    for (const f of fs.readdirSync("bin")) {
      const p = norm(path.join("bin", f));
      if (/\.(js|mjs|cjs)$/.test(f)) all.push(p);
    }
  }
  const entries = [];
  const unreadable = [];
  const addEntry = (v) => {
    if (typeof v === "string") {
      const f = norm(v.replace(/^\.\//, ""));
      if (all.includes(f)) entries.push(f);
      else unreadable.push(f);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v)) addEntry(x);
    }
  };
  addEntry(pkg.exports);
  addEntry(pkg.main);
  // T-116 redo: the probe this was copied from ALSO pushed every bin/*.js
  // straight into `entries` here, unconditionally — bypassing addEntry()
  // (and its `unreadable` tracking) entirely. Harmless for today's tree
  // (bin/ holds exactly the one file pkg.bin already declares), but it
  // meant `uniqEntries` could never be empty as long as bin/ held any .js
  // file at all, regardless of whether package.json's own exports/main/bin
  // fields resolved to anything real — the "0 declared entry points
  // resolved" guard below could never fire in this repo, a dead guard that
  // read as protection. addEntry(pkg.bin) above already resolves
  // `bin/browser-ai-bridge.js` correctly (the bin/ walk that populates
  // `all` now runs before this point) — the separate unconditional push
  // added nothing but the ability to mask that guard, so it's gone. `bin`'s
  // own entry points are now, like `exports` and `main`, exactly what
  // package.json DECLARES — not every file physically sitting in the
  // directory.
  addEntry(pkg.bin);
  const uniqEntries = [...new Set(entries)];
  const edgesFrom = (f) => {
    const src = fs.readFileSync(f, "utf8");
    const specs = [];
    const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
    let m;
    while ((m = re.exec(src))) specs.push(m[2]);
    const re2 = /import\s+(['"])([^'"]+)\1/g;
    while ((m = re2.exec(src))) specs.push(m[2]);
    return specs.map((s) => resolve(s, f)).filter(Boolean);
  };
  const seen = new Set();
  const queue = [...uniqEntries];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const t of edgesFrom(f)) if (!seen.has(t)) queue.push(t);
  }
  const srcFiles = all.filter((f) => f.startsWith("src/"));
  const dead = srcFiles.filter((f) => !seen.has(f));
  return { uniqEntries, srcFiles, seen, dead, unreadable };
}

function main() {
  let failed = false;
  const fail = (msg) => {
    console.error(`FAIL: ${msg}`);
    failed = true;
  };

  // Clause 3: no dynamic-import-by-computed-string anywhere would make this
  // whole census worthless (a template-literal import() the static walk
  // cannot follow). Re-checked on every run, not trusted from T-108/T-115's
  // own one-time greps.
  const dynamicImportHit = (() => {
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|mjs|cjs)$/.test(e.name)) files.push(p);
      }
    })("src");
    if (fs.existsSync("bin")) {
      for (const f of fs.readdirSync("bin")) files.push(path.join("bin", f));
    }
    for (const f of files) {
      let src;
      try {
        src = fs.readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (/import\(\s*`/.test(src)) return f;
    }
    return null;
  })();
  if (dynamicImportHit) {
    fail(
      `a template-literal dynamic import exists (${dynamicImportHit}) — this census cannot follow a computed import path, so its whole result is void until that site is accounted for by hand.`,
    );
  }

  let result;
  try {
    result = computeReachability();
  } catch (e) {
    console.log(
      "reachability: 0 of 0 reachable, 0 allowlisted, 0 unexpected (COULD NOT RUN)",
    );
    fail(`could not read the module graph: ${e.message}`);
    process.exit(1);
  }

  const { uniqEntries, srcFiles, dead, unreadable } = result;

  if (uniqEntries.length === 0) {
    fail(
      "0 declared entry points resolved — package.json's exports/main/bin, or bin/, changed shape under this gate. A census with no entry points is not a census.",
    );
  }
  if (unreadable.length > 0) {
    fail(
      `${unreadable.length} declared entry point(s) in package.json do not resolve to a real file — the census silently narrowing its own start set is exactly the failure this gate exists to catch:`,
    );
    for (const f of unreadable) console.error(`  ${f}`);
  }
  if (srcFiles.length === 0) {
    fail(
      "0 tracked src/ modules found — the src/ walk returned nothing. A census over an empty set is not a clean result.",
    );
  }

  let allowlist = null;
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    fail(`allowlist file is missing: ${ALLOWLIST_PATH}`);
  } else {
    try {
      allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    } catch (e) {
      fail(`allowlist file could not be parsed: ${e.message}`);
    }
  }
  allowlist = allowlist || [];

  const allowlistedPaths = new Set(allowlist.map((e) => e.path));
  const deadSet = new Set(dead);
  const unexpected = dead.filter((f) => !allowlistedPaths.has(f));

  // Clause 6: the allowlist's own entries are checked. An entry pointing at
  // a path that no longer exists, or that has BECOME reachable, is a stale
  // claim — reported, not silently trusted.
  const staleAllowlistEntries = [];
  for (const entry of allowlist) {
    const exists = srcFiles.includes(entry.path) || fs.existsSync(entry.path);
    if (!exists) {
      staleAllowlistEntries.push({
        path: entry.path,
        why: "no longer exists in the tree",
      });
    } else if (!deadSet.has(entry.path)) {
      staleAllowlistEntries.push({
        path: entry.path,
        why: "is now REACHABLE — this allowlist entry is stale",
      });
    }
  }

  // Clause 2: the denominator, printed unconditionally, pass or fail.
  console.log(
    `reachability: ${srcFiles.length - dead.length} of ${srcFiles.length} reachable, ${allowlist.length} allowlisted, ${unexpected.length} unexpected`,
  );

  if (unexpected.length > 0) {
    fail(`${unexpected.length} unreachable module(s) not in the allowlist:`);
    for (const f of unexpected) console.error(`  ${f}`);
  }

  if (staleAllowlistEntries.length > 0) {
    console.warn(
      `WARN: ${staleAllowlistEntries.length} allowlist entr${staleAllowlistEntries.length === 1 ? "y is" : "ies are"} stale:`,
    );
    for (const s of staleAllowlistEntries) {
      console.warn(`  ${s.path} — ${s.why}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
