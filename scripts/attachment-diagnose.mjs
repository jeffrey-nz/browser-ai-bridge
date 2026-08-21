#!/usr/bin/env node
/**
 * attachment-diagnose.mjs — T-014 clause 1. Drives a real upload through the
 * real production code path (uploadFileToPage, unmodified) against a live
 * provider tab, then reports the two numbers the acceptance asks for:
 *
 *   1. does a file-attachment node appear in the composer at all (screenshot)
 *   2. does DEFAULT_ATTACHMENT_EVIDENCE match anything at that instant
 *      (page.locator(sel).count())
 *
 * Connects to the SAME running Chrome the live bridge uses (via CDP) —
 * navigates the target provider's tab to a fresh chat first so no earlier
 * turn's attachment chip confounds the read, then calls uploadFileToPage
 * exactly as src/ai/generic/interaction.js and src/ai/chatgpt/.../input.js
 * do, with each provider's own real attachmentBtnSelector.
 *
 * Usage: node scripts/attachment-diagnose.mjs <providerId>
 *   providerId: zai | kimi | qwen | mistral | perplexity | chatgpt
 */
import { chromium } from "playwright-core";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uploadFileToPage,
  DEFAULT_ATTACHMENT_EVIDENCE,
} from "../src/ai/shared/uploadFile.js";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const providerId = process.argv[2];

const CHATGPT_ATTACH_SELECTOR =
  'button[aria-label*="Attach" i], button[aria-label*="attach file" i], ' +
  'button[data-testid*="attach" i], button[data-testid*="file" i], ' +
  '[class*="composer"] button:has(svg[class*="paperclip" i])';

const TARGETS = {
  chatgpt: {
    url: "https://chatgpt.com/",
    urlMatch: (u) => u.includes("chatgpt.com"),
    attachmentBtnSelector: CHATGPT_ATTACH_SELECTOR,
  },
};
for (const [id, spec] of Object.entries(GENERIC_SPECS)) {
  TARGETS[id] = {
    url: spec.url,
    urlMatch: spec.urlMatch,
    attachmentBtnSelector: spec.attachBtn,
  };
}

async function main() {
  const target = TARGETS[providerId];
  if (!target) {
    console.error(
      `unknown provider "${providerId}" — known: ${Object.keys(TARGETS).join(", ")}`,
    );
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => target.urlMatch(p.url()));
  if (!page) {
    console.log(`no open tab for ${providerId} — opening one`);
    page = await context.newPage();
  }
  await page.goto(target.url, { waitUntil: "load", timeout: 30000 });
  // Give the SPA a moment to finish its own client-side routing/hydration
  // after the hard navigation, same margin the real session setup uses.
  await page.waitForTimeout(3000);
  console.log(`[${providerId}] tab loaded fresh: ${page.url()}`);

  const dir = await mkdtemp(join(tmpdir(), "attach-diag-"));
  const filePath = join(dir, "probe.png");
  // Minimal valid 1x1 PNG — content doesn't matter, only that upload accepts it.
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(filePath, png1x1);

  let attached;
  let uploadErr = null;
  try {
    attached = await uploadFileToPage(page, filePath, {
      attachmentBtnSelector: target.attachmentBtnSelector,
    });
  } catch (err) {
    attached = false;
    uploadErr = err.message;
  }

  const evidenceCount = await page.locator(DEFAULT_ATTACHMENT_EVIDENCE).count();
  const screenshotPath = join(process.cwd(), `attach-diag-${providerId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // Broader-than-default sweep, so a blind-selector finding can point at what
  // SHOULD have been the evidence selector, not just confirm the default missed.
  const candidates = [
    'img[src^="blob:" i]',
    '[class*="attach" i]',
    '[class*="thumbnail" i]',
    '[class*="preview" i]',
    '[class*="file" i]',
    '[aria-label*="attach" i]',
    '[data-testid*="attach" i]',
    '[data-testid*="file" i]',
  ];
  const candidateCounts = {};
  for (const sel of candidates) {
    candidateCounts[sel] = await page.locator(sel).count();
  }

  console.log(`\n=== ${providerId} ===`);
  console.log(`uploadFileToPage() returned: ${attached}`);
  if (uploadErr) console.log(`  (threw: ${uploadErr})`);
  console.log(
    `DEFAULT_ATTACHMENT_EVIDENCE count right now: ${evidenceCount}`,
  );
  console.log(`screenshot: ${screenshotPath}`);
  console.log(`broader candidate sweep:`);
  for (const [sel, count] of Object.entries(candidateCounts)) {
    console.log(`  ${count}  ${sel}`);
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
