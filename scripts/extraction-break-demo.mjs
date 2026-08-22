#!/usr/bin/env node
// @one-shot-probe — closed-ticket evidence script, not meant to be re-run generally (T-085). Excluded from scripts/doc-check.mjs's bucket-one requirement by this marker, not by a hardcoded name.
/**
 * extraction-break-demo.mjs — T-005 acceptance clause 3, executed rather than
 * asserted.
 *
 * The generic provider's extractor (src/ai/generic/interaction.js) reads
 * `page.locator(spec.locators.responseBlock).last().innerText()`. For mistral
 * and qwen, the ORIGINAL responseBlock selector could also match the USER's
 * own turn — a selector that has only ever been observed working (i.e. only
 * ever run against a page where the assistant had already answered) has no
 * known meaning, which is this repo's own lesson from T-001 and it applies
 * to its own extractors just as much as to file uploads.
 *
 * This script runs the SAME mechanism (a Playwright locator + .last() +
 * innerText) against a REAL, already-open provider tab, once with the
 * deliberately-broken (pre-T-005) selector and once with the fixed one, and
 * prints both so the difference is visible rather than asserted.
 *
 * Requires the bridge to be running with the named provider's tab already
 * open (any turn, past or present) — this reads, it does not drive a turn.
 *
 * Usage:
 *   node scripts/extraction-break-demo.mjs mistral
 *   node scripts/extraction-break-demo.mjs qwen
 */
import { chromium } from "playwright-core";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

const BROKEN_SELECTORS = {
  // The exact selector this repo shipped before T-005 — kept here rather
  // than reconstructed, so this file is itself the record of what was wrong.
  mistral: "[class*='group/message']",
  qwen: "[class*='markdown' i], [class*='message' i][class*='content' i]",
};

async function main() {
  const providerId = process.argv[2];
  if (!providerId || !GENERIC_SPECS[providerId]) {
    console.error(
      `usage: node scripts/extraction-break-demo.mjs <${Object.keys(GENERIC_SPECS).join("|")}>`,
    );
    process.exit(1);
  }
  const spec = GENERIC_SPECS[providerId];
  const broken = BROKEN_SELECTORS[providerId];
  if (!broken) {
    console.error(`no recorded pre-T-005 selector for ${providerId}`);
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const match = context.pages().find((p) => spec.urlMatch(p.url()));
  if (!match) {
    console.error(
      `no open tab for ${spec.name} — open one via a real /api/ask turn first.`,
    );
    process.exit(1);
  }

  console.log(`tab: ${match.url()}\n`);

  const readWith = async (selector) => {
    const loc = match.locator(selector).last();
    const count = await match.locator(selector).count();
    const text = await loc.innerText().catch((e) => `<error: ${e.message}>`);
    return { count, text };
  };

  const brokenResult = await readWith(broken);
  console.log(`DELIBERATELY BROKEN selector (shipped pre-T-005):`);
  console.log(`  ${JSON.stringify(broken)}`);
  console.log(`  ${brokenResult.count} match(es), .last() innerText:`);
  console.log(`  ${JSON.stringify(brokenResult.text.slice(0, 200))}\n`);

  const fixedResult = await readWith(spec.locators.responseBlock);
  console.log(`FIXED selector (current specs.js):`);
  console.log(`  ${JSON.stringify(spec.locators.responseBlock)}`);
  console.log(`  ${fixedResult.count} match(es), .last() innerText:`);
  console.log(`  ${JSON.stringify(fixedResult.text.slice(0, 200))}\n`);

  const looksLikeEcho =
    /reply with exactly|look at the attached|answer with/i.test(
      brokenResult.text,
    );
  console.log(
    looksLikeEcho
      ? "DEMONSTRATED: the broken selector's .last() reports the USER's own turn " +
          "(the prompt), not the assistant's — a real failure, not a hypothetical one."
      : "NOTE: this page's current content did not trigger the echo on the broken " +
          "selector (e.g. both turns are present in an order where .last() still " +
          "lands correctly) — re-run right after a fresh short turn to catch it live.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
