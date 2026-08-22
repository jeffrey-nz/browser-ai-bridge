// T-108 clause 4: real before/after transcript for copilot's input_box
// resolution. OLD half must be run against a checkout of 391127b^
// (fab0b10) — this script imports whatever tryFallbacks/getChatInputArea
// resolve to at the time it's run, so point it at the right commit to
// reproduce either half. Run from the browser-ai-bridge repo root:
//   node evidence/t108-verify-copilot-input-box.mjs
import { chromium } from "playwright-core";
import { tryFallbacks } from "../src/ai/copilot/client/interaction/locator/fallbacks.js";
import { getChatInputArea } from "../src/ai/copilot/client/interaction/prompt/inputLocator.js";

const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage();
await page.goto(`data:text/html,<html><body>
  <div id="m365-chat-editor-target-element" contenteditable="true">FIRST IN DOM, FIRST IN THE LIST</div>
  <input id="searchbox" value="SECOND IN DOM, EIGHTH IN THE LIST">
</body></html>`);

const fb = await tryFallbacks(page, "input_box");
console.log(
  `tryFallbacks(page, "input_box")  picks: #${await fb.evaluate((e) => e.id)}`,
);

const loc = await getChatInputArea(page);
console.log(
  `getChatInputArea(page)           picks: #${await loc.evaluate((e) => e.id)}`,
);

// CONTROL: DOM order swapped, lists unchanged — the pick must still follow
// LIST order, not DOM order.
await page.goto(`data:text/html,<html><body>
  <input id="searchbox" value="FIRST IN DOM">
  <div id="m365-chat-editor-target-element" contenteditable="true">SECOND IN DOM</div>
</body></html>`);
const fb2 = await tryFallbacks(page, "input_box");
console.log(`\nCONTROL (DOM order swapped, list unchanged):`);
console.log(
  `tryFallbacks(page, "input_box")  picks: #${await fb2.evaluate((e) => e.id)}`,
);
const loc2 = await getChatInputArea(page);
console.log(
  `getChatInputArea(page)           picks: #${await loc2.evaluate((e) => e.id)}`,
);

await browser.close();
