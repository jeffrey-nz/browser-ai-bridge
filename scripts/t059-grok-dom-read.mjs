#!/usr/bin/env node
/**
 * t059-grok-dom-read.mjs — T-059. Settles, by direct live DOM read during a
 * real grok turn, whether the ECHO shape T-054 found (grok's reply contains
 * the sent prompt verbatim, blank lines carrying a literal space that
 * wasn't sent) is (i) the extractor reading OUR OWN user bubble because
 * `.last()` over a shared user+assistant selector picked the wrong node, or
 * (ii) grok genuinely echoing a prompt ProseMirror already mutated (blank
 * lines -> a line with one space) before submit.
 *
 * Drives the REAL production functions unmodified — startNewChat,
 * injectGrokText (clearAndType), clickGrokSend, waitForGrokCompletion — so
 * this reproduces exactly what a live turn does, with one extra read
 * inserted between typing and submitting that production code never takes.
 */
import { chromium } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { startNewChat } from "../src/ai/grok/interaction/chat.js";
import {
  injectGrokText,
  clickGrokSend,
} from "../src/ai/grok/interaction/prompt/input.js";
import { waitForGrokCompletion } from "../src/ai/grok/interaction/prompt/poll.js";
import { GROK_LOCATORS } from "../src/ai/grok/locators.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
// evidence/, not reports/ — reports/* is gitignored except reports/vision-probe/
// (see CLAUDE.md's "Evidence for live-verified tickets"); a plain `git add`
// on a reports/-rooted path here would silently do nothing.
const outPath =
  process.argv[2] || `evidence/t059-grok-dom-read-${Date.now()}.json`;

// Byte-identical shape to scripts/vision-probe.mjs's buildPrompt() — the
// blank-line structure is what matters here, not the specific count/color
// palette text, and T-072 already established grok echoes this same prompt
// shape blind (no image) at the same rate as the image-turn version.
function buildPrompt() {
  const palette = "crimson, teal, goldenrod, indigo";
  return (
    `Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, ` +
    `no other text:\n\n` +
    `SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest ` +
    `match from exactly this list: ${palette}>\n\n` +
    `...or reply with EXACTLY this if you cannot see any image at all:\n\n` +
    `SEES=no`
  );
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("grok.com"));
  if (!page) page = await context.newPage();

  await startNewChat(page);
  await page.waitForTimeout(500);

  const prompt = buildPrompt();
  console.log(
    "[t059] injecting prompt (production injectGrokText/clearAndType)...",
  );
  await injectGrokText(page, prompt);

  // CLAUSE 2 — read the composer's OWN content, after clearAndType, BEFORE
  // submit. This is the read production code never takes.
  const composerLocator = page.locator(GROK_LOCATORS.inputBox).first();
  const composerInnerText = await composerLocator.innerText().catch(() => null);
  console.log(
    `[t059] composer innerText before submit (JSON-escaped): ${JSON.stringify(composerInnerText)}`,
  );

  console.log("[t059] clicking send (production clickGrokSend)...");
  await clickGrokSend(page);

  console.log(
    "[t059] waiting for completion (production waitForGrokCompletion)...",
  );
  const completed = await waitForGrokCompletion(page);
  console.log(`[t059] waitForGrokCompletion returned: ${completed}`);

  // Let the DOM settle a moment longer before the dump.
  await page.waitForTimeout(1000);

  // CLAUSE 1 — dump every match, in document order, of the SAME selector
  // poll.js/extract.js use, with enough per-node detail to tell the user's
  // bubble from the assistant's without guessing.
  const selector = GROK_LOCATORS.responseBlock;
  const nodes = page.locator(selector);
  const count = await nodes.count();
  const dump = [];
  for (let i = 0; i < count; i++) {
    const el = nodes.nth(i);
    const className = await el.getAttribute("class").catch(() => null);
    const id = await el.getAttribute("id").catch(() => null);
    const text = await el
      .innerText()
      .then((t) => t.slice(0, 200))
      .catch(() => null);
    dump.push({ index: i, className, id, innerTextFirst200: text });
  }

  const result = {
    ts: new Date().toISOString(),
    prompt,
    composerInnerTextBeforeSubmit: composerInnerText,
    composerContainsSpaceInBlankLine: composerInnerText
      ? composerInnerText.includes("\n \n") ||
        /\n[ \t]+\n/.test(composerInnerText)
      : null,
    waitForGrokCompletionReturned: completed,
    selectorUsed: selector,
    matchCount: count,
    domDump: dump,
    lastNodeIsIndex: dump.length - 1,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(
    `[t059] ${count} node(s) matched "${selector}", in document order:`,
  );
  dump.forEach((d) =>
    console.log(
      `  [${d.index}] class=${JSON.stringify(d.className)} id=${JSON.stringify(d.id)} text="${(d.innerTextFirst200 || "").replace(/\n/g, "\\n")}"`,
    ),
  );
  console.log(`[t059] report written to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
