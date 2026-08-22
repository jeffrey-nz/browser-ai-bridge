#!/usr/bin/env node
// @one-shot-probe — closed-ticket evidence script, not meant to be re-run generally (T-085). Excluded from scripts/doc-check.mjs's bucket-one requirement by this marker, not by a hardcoded name.
// T-022: attachment-diagnose.mjs's table doesn't print the raw
// input[type="file"] count/visibility that uploadFileToPage's Strategy 1
// actually branches on — it prints the EVIDENCE selectors (post-attach), not
// the attach mechanism itself. Read-only probe against the live qwen tab to
// see exactly what's on the page right now, and what a click on the
// composer's "+" button reveals. Does not call uploadFileToPage or touch any
// production code path.
import { chromium } from "playwright-core";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => p.url().includes("qwen.ai"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://chat.qwen.ai/", { waitUntil: "load" });
    await page.waitForTimeout(3000);
  }

  const fileInputs = page.locator('input[type="file"]');
  console.log(
    `BEFORE any click — input[type="file"] count: ${await fileInputs.count()}`,
  );
  for (let i = 0; i < (await fileInputs.count()); i++) {
    const el = fileInputs.nth(i);
    console.log(
      `  [${i}] visible=${await el.isVisible().catch(() => "err")} outerHTML=${(await el.evaluate((n) => n.outerHTML).catch(() => "?")).slice(0, 200)}`,
    );
  }

  // The composer's "+" button, visible in the screenshot to the left of the
  // "Ask Qwen" placeholder.
  const candidates = [
    'button[class*="plus" i]',
    'button[aria-label*="add" i]',
    'button[aria-label*="upload" i]',
    'button[aria-label*="attach" i]',
    ".message-input-left-button",
    '[class*="input-left" i] button',
  ];
  console.log("\nLooking for the '+' button by candidate selectors:");
  for (const sel of candidates) {
    const c = await page.locator(sel).count();
    console.log(`  ${sel} -> count ${c}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
