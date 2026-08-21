#!/usr/bin/env node
import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP(
  process.env.CDP_URL || "http://127.0.0.1:9222",
);
const context = browser.contexts()[0];
for (const p of context.pages()) console.log(p.url());
process.exit(0);
