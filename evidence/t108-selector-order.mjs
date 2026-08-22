// METHOD PROBE — does the copilot input-box selector list's ORDER do anything?
// No network, no provider, no profile: headless msedge on a data: URL.
// Run from the browser-ai-bridge repo root:  node <this>
import { chromium } from 'playwright-core'
import { FALLBACK_SELECTORS, tryFallbacks } from './src/ai/copilot/client/interaction/locator/fallbacks.js'

// verbatim from src/ai/copilot/client/interaction/prompt/inputLocator.js:14-25
const DEFAULT_LIST = [
  '#m365-chat-editor-target-element',
  '[data-lexical-editor="true"]',
  '#userInput',
  '[data-testid="composer-input"]',
  'textarea[aria-label*="Copilot" i]',
  'textarea',
  '[contenteditable="true"]',
  '#searchbox',
  '[role="textbox"]',
]

const PAGE = `data:text/html,<html><body>
  <div id="m365-chat-editor-target-element" contenteditable="true">FIRST IN DOM, FIRST IN THE LIST</div>
  <input id="searchbox" value="SECOND IN DOM, EIGHTH IN THE LIST">
</body></html>`

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage()
await page.goto(PAGE)

const joined = DEFAULT_LIST.join(', ')
const all = await page.locator(joined).filter({ visible: true }).all()
console.log(`the joined list matches ${all.length} visible element(s), in this order:`)
for (const el of all) console.log('   ', await el.evaluate(e => e.id))

const picked = page.locator(joined).filter({ visible: true }).last()
console.log(`\ninputLocator.js's own expression  .locator(list.join(", ")).filter({visible:true}).last()`)
console.log(`  picks: #${await picked.evaluate(e => e.id)}   (list position ${DEFAULT_LIST.findIndex(s => s === '#searchbox') + 1} of ${DEFAULT_LIST.length})`)

const fb = await tryFallbacks(page, 'input_box')
console.log(`\nfallbacks.js's own tryFallbacks(page, "input_box")  — a loop, first visible wins`)
console.log(`  picks: #${await fb.evaluate(e => e.id)}`)

console.log(`\nFALLBACK_SELECTORS.input_box order vs inputLocator.js's order:`)
console.log('  fallbacks.js :', FALLBACK_SELECTORS.input_box.join('  '))
console.log('  inputLocator :', DEFAULT_LIST.join('  '))

// and the control: reverse the DOM order, same page content
await page.goto(`data:text/html,<html><body>
  <input id="searchbox" value="FIRST IN DOM">
  <div id="m365-chat-editor-target-element" contenteditable="true">SECOND IN DOM</div>
</body></html>`)
const picked2 = page.locator(joined).filter({ visible: true }).last()
console.log(`\nCONTROL — same two elements, DOM order swapped, list unchanged:`)
console.log(`  .last() now picks: #${await picked2.evaluate(e => e.id)}`)

await browser.close()
