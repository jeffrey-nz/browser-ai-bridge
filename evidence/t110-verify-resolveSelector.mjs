// T-110 clause 1/3: real transcript for resolveSelector()'s (deepseek-only)
// list-order bug. Runs the ACTUAL resolveSelector() against a fixture with
// two elements matching different DEEPSEEK_LOCATORS.inputBox entries —
// list position 1 ("Message DeepSeek" textarea) FIRST in the DOM, list
// position 4 (#chat-input) SECOND. Pre-fix, resolveSelector's own
// Array.isArray() check is false for every deepseek caller (all pass a
// pre-joined comma STRING, not an array — src/ai/deepseek/locators.js), so
// its for-loop runs once over the WHOLE joined string, functionally
// identical to a joined-selector-plus-`.last()` resolution: DOM-last wins,
// list order is inert. This fix splits a string chain into its real
// candidates (respecting paren nesting, since `:has(a, b)` uses a comma
// that is not a separator) so the loop actually walks them in the order
// DEEPSEEK_LOCATORS lists.
//
// To reproduce the BEFORE half: check out the commit before this ticket
// and run this same script there — the import below always resolves to
// whatever resolveSelector currently is at the commit this runs from.
//
// Run from the browser-ai-bridge repo root:
//   node evidence/t110-verify-resolveSelector.mjs
import { chromium } from "playwright-core";
import { resolveSelector } from "../src/ai/shared/locatorEngine.js";
import { DEEPSEEK_LOCATORS } from "../src/ai/deepseek/locators.js";

const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage();
await page.goto(`data:text/html,<html><body>
  <textarea placeholder="Message DeepSeek" id="pos1">LIST POSITION 1, FIRST IN DOM</textarea>
  <textarea id="chat-input">LIST POSITION 4, SECOND IN DOM</textarea>
</body></html>`);

const picked = await resolveSelector(page, DEEPSEEK_LOCATORS.inputBox);
const id = await page
  .locator(picked)
  .last()
  .evaluate((e) => e.id)
  .catch(() => "(could not resolve returned selector to one element)");
console.log(`resolveSelector returned "${picked}"`);
console.log(`  -> resolves to element #${id}`);

await browser.close();
