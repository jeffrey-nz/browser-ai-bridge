#!/usr/bin/env node
/**
 * t023-kill-pages.mjs — T-023's reproduction, same CDP pattern break-demo.mjs
 * already established: connect to the SAME running Chrome the live bridge
 * uses, and close pages underneath it without telling the bridge. Unlike
 * break-demo.mjs (which opens its OWN blank pages to probe uploadFileToPage),
 * this closes every page the bridge itself currently owns — reproducing the
 * 03:12 shape (T-003's incident record): every provider tab dies at once,
 * CDP connection and browser process untouched.
 *
 * Usage: node scripts/t023-kill-pages.mjs
 */
import { chromium } from "playwright-core";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
// Pass a URL substring on argv to close only matching pages — closing every
// page including Chrome's last remaining tab quits the whole browser process
// and drops CDP itself, which is a DIFFERENT (already-handled) failure mode
// from T-023's target: pages dead, CDP/browser process still alive.
const urlFilter = process.argv[2] || null;

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const targets = urlFilter
    ? pages.filter((p) => p.url().includes(urlFilter))
    : pages;
  console.log(
    `Found ${pages.length} page(s); closing ${targets.length}${urlFilter ? ` matching "${urlFilter}"` : ""}.`,
  );
  for (const p of targets) {
    const url = p.url();
    try {
      await p.close();
      console.log(`  closed: ${url}`);
    } catch (err) {
      console.log(`  failed to close ${url}: ${err.message}`);
    }
  }
  console.log(
    "Done. NOT calling browser.close() — see break-demo.mjs's note on why.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
