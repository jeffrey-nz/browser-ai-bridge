// T-108 clause 4: real end-to-end transcript for gemini's upload-menu
// button resolution. Runs the ACTUAL uploadFileToGemini() against a
// fixture with an OLDER-build button ("Open upload file menu") EARLIER in
// the DOM and a NEWER-build button ("Upload & tools") second — each with a
// real onclick handler recording whether it was the one actually clicked,
// not inferred. Both runs throw downstream (no real "Upload from
// computer" menu item exists in the fixture) — expected, and irrelevant to
// what this checks: which button got clicked BEFORE that.
//
// To reproduce the BEFORE half (pre-T-108, joined selector + `.first()`):
// check out 391127b^ (fab0b10) and run this same script there — the
// import below always resolves to whatever uploadFileToGemini currently
// is at the commit this runs from.
//
// Run from the browser-ai-bridge repo root:
//   node evidence/t108-verify-gemini-upload-menu.mjs
import { chromium } from "playwright-core";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFileToGemini } from "../src/ai/gemini/interaction/prompt/input.js";

const dir = mkdtempSync(join(tmpdir(), "gemini-t108-"));
const filePath = join(dir, "fixture.png");
writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const PAGE = `data:text/html,<html><body>
  <button aria-label="Open upload file menu" onclick="this.setAttribute('data-clicked','1')">OLDER BUILD, FIRST IN DOM</button>
  <button aria-label="Upload & tools" onclick="this.setAttribute('data-clicked','1')">NEWER BUILD, SECOND IN DOM</button>
</body></html>`;

const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage();
await page.goto(PAGE);
try {
  await uploadFileToGemini(page, filePath, {});
} catch (e) {
  console.log(
    `(expected downstream throw once past menu resolution: ${e.constructor.name}: ${e.message.slice(0, 80)})`,
  );
}
const older = await page
  .locator('[aria-label="Open upload file menu"]')
  .getAttribute("data-clicked");
const newer = await page
  .locator('[aria-label="Upload & tools"]')
  .getAttribute("data-clicked");
console.log(
  `older-build clicked=${older === "1"}  newer-build clicked=${newer === "1"}`,
);

await browser.close();
rmSync(dir, { recursive: true, force: true });
