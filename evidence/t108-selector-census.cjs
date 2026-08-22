const fs=require('fs'), path=require('path')
function walk(d,acc=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=path.join(d,e.name);e.isDirectory()?walk(p,acc):(p.endsWith('.js')||p.endsWith('.mjs'))&&acc.push(p)}return acc}
const files=walk('src')
let joinedTotal=0, joinedLast=0, joinedFirst=0, joinedOther=0
const rows=[]
for(const f of files){
  const s=fs.readFileSync(f,'utf8')
  // .locator( ... ) whose argument text contains a top-level comma inside a string or a .join(", ")
  const re=/\.locator\(\s*([\s\S]{0,900}?)\)\s*(\.[A-Za-z]+\([^)]*\)\s*)*/g
  let m
  while((m=re.exec(s))){
    const arg=m[1]
    const isJoined = /\.join\(\s*["'`],\s*["'`]\s*\)/.test(arg) || (/^["'`]/.test(arg.trim()) && /,\s/.test(arg))
    if(!isJoined) continue
    joinedTotal++
    const tail=s.slice(m.index, m.index+m[0].length+40)
    const line=s.slice(0,m.index).split('\n').length
    let kind='other'
    if(/\.last\(\)/.test(tail)) {kind='last'; joinedLast++}
    else if(/\.first\(\)/.test(tail)) {kind='first'; joinedFirst++}
    else joinedOther++
    const n=(arg.match(/,/g)||[]).length
    rows.push(`${f}:${line}  ${kind}  ~${n+1} selector(s)`)
  }
}
console.log(`.locator() calls whose argument is a comma-joined MULTI-selector: ${joinedTotal}`)
console.log(`  followed by .last() : ${joinedLast}`)
console.log(`  followed by .first(): ${joinedFirst}`)
console.log(`  neither             : ${joinedOther}`)
console.log(rows.join('\n'))
