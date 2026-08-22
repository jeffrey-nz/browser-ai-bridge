import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";

const CLONE = process.argv[2];
const { DEEPSEEK_LOCATORS } = await import(
  pathToFileURL(path.join(CLONE, "src/ai/deepseek/locators.js")).href
);

const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage();

async function probe(label, listStr, op, html, swapped) {
  console.log("\n==== " + label + "   ." + op + "()");
  await page.goto("data:text/html," + encodeURIComponent(html));
  const all = await page.locator(listStr).filter({ visible: true }).all();
  console.log("  matches " + all.length + " visible, DOM order:");
  for (const el of all) console.log("    #" + (await el.evaluate((e) => e.id)));
  const pick = page.locator(listStr).filter({ visible: true })[op]();
  console.log("  picks: #" + (await pick.evaluate((e) => e.id)));
  await page.goto("data:text/html," + encodeURIComponent(swapped));
  const p2 = page.locator(listStr).filter({ visible: true })[op]();
  console.log("  CONTROL, DOM order swapped: picks #" + (await p2.evaluate((e) => e.id)));
}

// chat.js:8 — .first(), list position 1 is specific, position 3 is broad
await probe("DEEPSEEK_LOCATORS.newChatBtn", DEEPSEEK_LOCATORS.newChatBtn, "first",
  `<html><body><button id="broad" aria-label="New chat">x</button>
   <div id="specific" tabindex="0"><span>New chat</span></div></body></html>`,
  `<html><body><div id="specific" tabindex="0"><span>New chat</span></div>
   <button id="broad" aria-label="New chat">x</button></body></html>`);

// chat.js:9 — .last(), list position 1 is the real box, position 4 is #chat-input
await probe("DEEPSEEK_LOCATORS.inputBox", DEEPSEEK_LOCATORS.inputBox, "last",
  `<html><body><textarea id="realbox" placeholder="Message DeepSeek"></textarea>
   <input id="chat-input"></body></html>`,
  `<html><body><input id="chat-input">
   <textarea id="realbox" placeholder="Message DeepSeek"></textarea></body></html>`);

await browser.close();
