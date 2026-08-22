// The full population of "a comma-joined selector list resolved by POSITION",
// split into the tiers a literal-argument census can and cannot see.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(d, e.name);
    e.isDirectory()
      ? walk(p, acc)
      : (p.endsWith(".js") || p.endsWith(".mjs")) && acc.push(p);
  }
  return acc;
}
const files = walk("src");
const norm = (s) => s.split(path.sep).join("/");

// tier 1: T-108's census, verbatim
const t1 = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const re = /\.locator\(\s*([\s\S]{0,900}?)\)\s*(\.[A-Za-z]+\([^)]*\)\s*)*/g;
  let m;
  while ((m = re.exec(s))) {
    const arg = m[1];
    const isJoined =
      /\.join\(\s*["'`],\s*["'`]\s*\)/.test(arg) ||
      (/^["'`]/.test(arg.trim()) && /,\s/.test(arg));
    if (!isJoined) continue;
    t1.add(norm(f) + ":" + s.slice(0, m.index).split("\n").length);
  }
}

// the named constants, split multi vs single (the control)
const multi = new Map(), single = new Map();
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  let obj = null, depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const decl = L.match(/^export const ([A-Z][A-Z0-9_]*)\s*=\s*\{/);
    if (decl) { obj = decl[1]; depth = 1; continue; }
    if (!obj) continue;
    const pm = L.match(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (pm) {
      let val = pm[2].trim();
      if (val === "") val = (lines[i + 1] || "").trim();
      const sm = val.match(/^(['"`])([\s\S]*?)\1\s*,?\s*$/);
      if (sm) {
        const n = sm[2].split(/,\s/).length;
        (n > 1 ? multi : single).set(obj + "." + pm[1], { file: norm(f), line: i + 1, n });
      }
    }
    depth += (L.match(/\{/g) || []).length - (L.match(/\}/g) || []).length;
    if (depth <= 0) obj = null;
  }
}

const CONSUMERS =
  /(\.locator\(|resolveSelector\(|resolveVisibleInOrder\(|tryFallbacks\(|waitForSelector\()/;
function sitesFor(names) {
  const out = [], seen = new Set();
  for (const f of files) {
    if (/(locators|constants)\.js$/.test(f)) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++)
      for (const nm of names) {
        if (!lines[i].includes(nm)) continue;
        if (!CONSUMERS.test(lines.slice(Math.max(0, i - 3), i + 4).join("\n"))) continue;
        const at = norm(f) + ":" + (i + 1);
        if (seen.has(at)) continue;
        seen.add(at); out.push({ at, nm }); break;
      }
  }
  return out;
}
const t2 = sitesFor([...multi.keys()]), ctrl = sitesFor([...single.keys()]);
const overlap = t2.filter((r) => t1.has(r.at));

console.log("browser-ai-bridge " + execSync("git rev-parse --short HEAD").toString().trim());
console.log("TIER 1  literal comma-joined arg (T-108's census) : " + t1.size);
console.log("TIER 2  named multi constant, by name             : " + t2.length);
console.log("        overlap tier1 n tier2                     : " + overlap.length);
console.log("known population                                  : " + (t1.size + t2.length - overlap.length));
console.log("CONTROL named SINGLE constant, by name            : " + ctrl.length);
console.log("        multi declared " + multi.size + " / single " + single.size);
for (const r of t2) console.log("  " + r.at + "  " + r.nm);
