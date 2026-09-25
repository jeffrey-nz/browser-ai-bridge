#!/usr/bin/env node
// @one-shot-probe — closed-ticket evidence script, not meant to be re-run generally (T-085). Excluded from scripts/doc-check.mjs's bucket-one requirement by this marker, not by a hardcoded name.
import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP(
  process.env.CDP_URL || "http://127.0.0.1:9222",
);
const context = browser.contexts()[0];
for (const p of context.pages()) console.log(p.url());
process.exit(0);
