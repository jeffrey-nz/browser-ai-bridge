#!/usr/bin/env node
// dom-diagnose.mjs — written for T-005, kept as a TOOL (T-085): all four
// modes below take a live provider page (any urlSubstr) and a selector as
// ARGUMENTS, so the same file answers the next selector-debugging question
// against a page that does not exist yet, not just T-005's original one —
// unlike break-demo.mjs/extraction-break-demo.mjs (T-085's own one-shot
// examples), which hardcode ONE historical before/after pair with no
// target argument at all. Inspect what a selector actually matches on a
// live provider page, right after a real turn, without touching bridge
// internals.
//
// Modes:
//   node dom-diagnose.mjs <urlSubstr> <cssSelector>         list matches
//   node dom-diagnose.mjs <urlSubstr> --find "text to find"  print the
//     ancestor chain (tag + class) of every element whose OWN text node
//     contains the given string, innermost first — for finding what class
//     actually wraps a known answer when a guessed selector comes up empty.
//   node dom-diagnose.mjs <urlSubstr> --siblings <selector> [levels]
//     walk up `levels` ancestors from the first match and list its children.
//   node dom-diagnose.mjs <urlSubstr> --screenshot <outPath>
//     save a PNG of the current page state.
import { chromium } from "playwright-core";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const urlSubstr = process.argv[2];
const mode = process.argv[3];
const arg = process.argv[4];

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find((p) => p.url().includes(urlSubstr));
  if (!page) {
    console.error(
      `no open tab matching "${urlSubstr}" — tabs: ${pages.map((p) => p.url()).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`tab: ${page.url()}`);

  if (mode === "--screenshot") {
    await page.screenshot({ path: arg, fullPage: false });
    console.log(`saved to ${arg}`);
    return;
  }

  if (mode === "--find") {
    const chains = await page.evaluate((needle) => {
      const out = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.includes(needle)) {
          const chain = [];
          let el = node.parentElement;
          let depth = 0;
          while (el && depth < 8) {
            chain.push(
              `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).replace(/\s+/g, ".") : ""}`,
            );
            el = el.parentElement;
            depth++;
          }
          out.push(chain);
        }
      }
      return out;
    }, arg);
    console.log(
      `text nodes containing ${JSON.stringify(arg)}: ${chains.length}\n`,
    );
    chains.forEach((chain, i) => {
      console.log(`  [${i}] ${chain.join(" < ")}`);
    });
    return;
  }

  if (mode === "--siblings") {
    // Walk up `levels` ancestors from the first match of `selector`, then
    // list that ancestor's children (class + short text) — for finding a
    // sibling turn container when a known-good selector only ever matches
    // one side of the conversation.
    const levels = Number(process.argv[5] || 3);
    const info = await page.evaluate(
      ({ sel, levels }) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        let anc = el;
        for (let i = 0; i < levels && anc.parentElement; i++)
          anc = anc.parentElement;
        return Array.from(anc.children).map((c) => ({
          tag: c.tagName.toLowerCase(),
          cls: c.className || "",
          text: (c.innerText || "").slice(0, 150),
        }));
      },
      { sel: arg, levels },
    );
    if (!info) {
      console.log(`no element matched "${arg}"`);
      return;
    }
    console.log(
      `ancestor (${levels} levels up from "${arg}") has ${info.length} children:\n`,
    );
    info.forEach((c, i) => {
      console.log(`  [${i}] <${c.tag} class="${c.cls}">`);
      console.log(`      ${JSON.stringify(c.text)}`);
    });
    return;
  }

  const selector = mode;
  const matches = await page.locator(selector).all();
  console.log(`selector "${selector}" matches ${matches.length} element(s):\n`);
  for (let i = 0; i < matches.length; i++) {
    const text = await matches[i]
      .innerText()
      .catch((e) => `<error: ${e.message}>`);
    const isLast = i === matches.length - 1 ? "  <-- .last()" : "";
    console.log(`  [${i}] ${JSON.stringify(text.slice(0, 200))}${isLast}`);
  }
}

main()
  .then(() => process.exit(0)) // the CDP websocket keeps the event loop alive
  // otherwise — exit explicitly rather than calling browser.close(), which
  // kills the whole shared Chrome instance (see scripts/break-demo.mjs).
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
