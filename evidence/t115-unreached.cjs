#!/usr/bin/env node
'use strict'
// WHICH TRACKED src/ MODULES IS NOTHING ABLE TO IMPORT? — method, 2026-08-22.
// Static reachability from the package's declared entry points, following static
// `import ... from "..."`, `export ... from "..."` and dynamic `import("...")`.
// Resolves relative paths, the #alias map in package.json, and directory/index.js.
// Reads source only. No browser, no network, writes nothing.
const fs = require('fs'), path = require('path')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const norm = p => p.split(path.sep).join('/')
const all = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(js|mjs|cjs)$/.test(e.name)) all.push(norm(p))
  }
})('src')
const aliases = Object.entries(pkg.imports || {})
const resolve = (spec, fromFile) => {
  let base = null
  if (spec.startsWith('.')) base = norm(path.join(path.dirname(fromFile), spec))
  else {
    for (const [k, v] of aliases) {
      if (k.endsWith('/*') && spec.startsWith(k.slice(0, -1))) {
        base = norm(path.join(v.replace('/*', ''), spec.slice(k.length - 1))); break
      }
      if (k === spec) { base = norm(v.replace(/^\.\//, '')); break }
    }
  }
  if (!base) return null
  base = base.replace(/^\.\//, '')
  const tries = [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js', base + '/index.mjs']
  for (const t of tries) if (all.includes(t)) return t
  return null
}
const entries = []
const addEntry = v => { if (typeof v === 'string') { const f = norm(v.replace(/^\.\//, '')); if (all.includes(f)) entries.push(f) }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) addEntry(x) }
addEntry(pkg.exports); addEntry(pkg.main); addEntry(pkg.bin)
if (fs.existsSync('bin')) for (const f of fs.readdirSync('bin')) {
  const p = norm(path.join('bin', f))
  if (/\.(js|mjs|cjs)$/.test(f)) { all.push(p); entries.push(p) }
}
const uniqEntries = [...new Set(entries)]
const edgesFrom = f => {
  const src = fs.readFileSync(f, 'utf8')
  const specs = []
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g
  let m; while ((m = re.exec(src))) specs.push(m[2])
  const re2 = /import\s+(['"])([^'"]+)\1/g
  while ((m = re2.exec(src))) specs.push(m[2])
  return specs.map(s => resolve(s, f)).filter(Boolean)
}
const seen = new Set(), queue = [...uniqEntries]
while (queue.length) {
  const f = queue.pop()
  if (seen.has(f)) continue
  seen.add(f)
  for (const t of edgesFrom(f)) if (!seen.has(t)) queue.push(t)
}
const srcFiles = all.filter(f => f.startsWith('src/'))
const dead = srcFiles.filter(f => !seen.has(f))
console.log(`entry points: ${uniqEntries.length}  ${uniqEntries.join(' ')}`)
console.log(`tracked src/ modules: ${srcFiles.length}`)
console.log(`reachable from an entry point: ${srcFiles.filter(f => seen.has(f)).length}`)
console.log(`NOT reachable: ${dead.length}\n`)
const byDir = new Map()
for (const f of dead) { const d = f.split('/').slice(0, -1).join('/'); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(f.split('/').pop()) }
for (const [d, fs2] of [...byDir.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${d}/   ${fs2.length} file(s): ${fs2.join(', ')}`)
