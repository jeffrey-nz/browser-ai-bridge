#!/usr/bin/env node
'use strict'
// THE FILE/DIRECTORY SHADOW PAIRS, AND WHO ACTUALLY IMPORTS WHICH HALF.
// method, 2026-08-22. Resolves every import spec the way Node ESM does (a
// relative "./X.js" is the FILE; "./X" is the directory's index.js), so the two
// halves of a shadow pair are counted separately and by path, not by basename.
const fs = require('fs'), path = require('path')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const norm = p => p.split(path.sep).join('/')
const all = [], dirs = new Set()
;(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) { dirs.add(norm(p)); w(p) } else if (/\.(js|mjs|cjs)$/.test(e.name)) all.push(norm(p))
  }
})('src')
if (fs.existsSync('bin')) for (const f of fs.readdirSync('bin')) if (/\.js$/.test(f)) all.push(norm(path.join('bin', f)))
const aliases = Object.entries(pkg.imports || {})
const resolve = (spec, from) => {
  let base = null
  if (spec.startsWith('.')) base = norm(path.join(path.dirname(from), spec))
  else for (const [k, v] of aliases) {
    if (k.endsWith('/*') && spec.startsWith(k.slice(0, -1))) { base = norm(path.join(v.replace('/*', ''), spec.slice(k.length - 1))); break }
    if (k === spec) { base = norm(v.replace(/^\.\//, '')); break }
  }
  if (!base) return null
  base = base.replace(/^\.\//, '')
  for (const t of [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js', base + '/index.mjs'])
    if (all.includes(t)) return t
  return null
}
const importers = new Map()
for (const f of all) {
  const src = fs.readFileSync(f, 'utf8')
  const specs = []
  let m
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g
  while ((m = re.exec(src))) specs.push(m[2])
  const re2 = /import\s+(['"])([^'"]+)\1/g
  while ((m = re2.exec(src))) specs.push(m[2])
  for (const s of specs) {
    const t = resolve(s, f)
    if (!t) continue
    if (!importers.has(t)) importers.set(t, [])
    importers.get(t).push(`${f}  ("${s}")`)
  }
}
const pairs = []
for (const f of all) {
  const stem = f.replace(/\.js$/, '')
  if (dirs.has(stem) && all.includes(stem + '/index.js')) pairs.push({ file: f, index: stem + '/index.js', dir: stem })
}
console.log(`FILE X.js AND DIRECTORY X/index.js BOTH EXIST — both importable, "./X.js" silently picks the FILE\n`)
console.log(`pairs: ${pairs.length}\n`)
for (const p of pairs) {
  const a = importers.get(p.file) || [], b = importers.get(p.index) || []
  const dirFiles = fs.readdirSync(p.dir).filter(x => /\.js$/.test(x))
  console.log(`== ${p.dir}`)
  console.log(`   FILE  ${p.file}         importers: ${a.length}`)
  for (const x of a) console.log(`         <- ${x}`)
  console.log(`   INDEX ${p.index}   importers: ${b.length}   (directory holds ${dirFiles.length} js: ${dirFiles.join(', ')})`)
  for (const x of b) console.log(`         <- ${x}`)
  const verdict = a.length && b.length ? 'BOTH HALVES LIVE — two modules, one name, in one process'
    : a.length ? 'the DIRECTORY is unimported'
      : b.length ? 'the FILE is unimported'
        : 'NEITHER is imported'
  console.log(`   -> ${verdict}\n`)
}
