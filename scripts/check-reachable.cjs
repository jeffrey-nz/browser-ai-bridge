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
  addEntry(pkg.bin);
  if (fs.existsSync("bin")) {
    for (const f of fs.readdirSync("bin")) {
      const p = norm(path.join("bin", f));
      if (/\.(js|mjs|cjs)$/.test(f)) entries.push(p);
    }
  }
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
