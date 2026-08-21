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
 * EVERY SELECTOR IS MEASURED BEFORE THE UPLOAD TOO (T-020). A post-upload-only
 * count cannot tell an attachment that arrived from one that was already
 * there. T-014 named `.chip-scroll` as zai's evidence selector on exactly
 * this script's post-upload-only output — the card was visible, the reading
 * looked unambiguous, and it was wrong: zai persists UNSENT draft attachments
 * against the logged-in ACCOUNT, across tabs, so the "fresh" composer this
 * script navigated to already had three real image chips sitting in it. A
 * before-count would have printed the contradiction on the first run instead
 * of costing a live session, a revert, and two review round trips. Any
 * selector whose before-count is non-zero is flagged unusable in the output —
 * it cannot distinguish this turn's own attachment from page furniture or an
 * earlier turn's leftovers.
 *
 * Usage: node scripts/attachment-diagnose.mjs <providerId>
 *   providerId: zai | kimi | qwen | mistral | perplexity | chatgpt | deepseek | grok
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
import { uploadFileToDeepSeek } from "../src/ai/deepseek/interaction/prompt/input.js";
import { uploadFileToGrok } from "../src/ai/grok/interaction/prompt/input.js";

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
  deepseek: {
    url: "https://chat.deepseek.com/",
    urlMatch: (u) => u.includes("deepseek.com"),
    // Use the real exported function rather than re-declaring its selector —
    // this is the only target here that also names a real upload() call so
    // a caller can compare "call the real function" vs "call the shared
    // helper with the selector copied out of it" if the two ever diverge.
    upload: uploadFileToDeepSeek,
  },
  grok: {
    url: "https://grok.com/",
    urlMatch: (u) => u.includes("grok.com"),
    upload: uploadFileToGrok,
  },
};
for (const [id, spec] of Object.entries(GENERIC_SPECS)) {
  TARGETS[id] = {
    url: spec.url,
    urlMatch: spec.urlMatch,
    attachmentBtnSelector: spec.attachBtn,
    attachEvidence: spec.attachEvidence || null,
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

  // Broader-than-default sweep, so a blind-selector finding can point at what
  // SHOULD have been the evidence selector, not just confirm the default missed.
  const candidates = [
    'img[src^="blob:" i]',
    '[class*="attach" i]',
    '[class*="thumbnail" i]',
    '[class*="preview" i]',
    '[class*="file" i]',
    // "chip" (T-020, zai): the shape uploadFile.js's own docstring already
    // names — "a named attachment/file chip" — but the pattern list never
    // included it. zai's real attachment card is a `.chip-scroll`-wrapped
    // button with no other matching class.
    '[class*="chip" i]',
    '[aria-label*="attach" i]',
    '[data-testid*="attach" i]',
    '[data-testid*="file" i]',
  ];
  // DEFAULT_ATTACHMENT_EVIDENCE and the provider's own attachEvidence (if its
  // spec sets one) go first, labelled, ahead of the generic sweep — they're
  // the selectors that actually decide imageAttached, not just candidates.
  const named = [["DEFAULT_ATTACHMENT_EVIDENCE", DEFAULT_ATTACHMENT_EVIDENCE]];
  if (target.attachEvidence)
    named.push(["spec.attachEvidence", target.attachEvidence]);
  const allSelectors = [...named, ...candidates.map((c) => [c, c])];

  const countAll = async () => {
    const out = {};
    for (const [label, sel] of allSelectors)
      out[label] = await page.locator(sel).count();
    return out;
  };

  // BEFORE (T-020): measured on the composer exactly as loaded, before any
  // upload is attempted — this is the number that would have caught
  // .chip-scroll being non-zero on a "fresh" zai composer.
  const before = await countAll();

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
    attached = target.upload
      ? await target.upload(page, filePath)
      : await uploadFileToPage(page, filePath, {
          attachmentBtnSelector: target.attachmentBtnSelector,
        });
  } catch (err) {
    attached = false;
    uploadErr = err.message;
  }

  const after = await countAll();
  const screenshotPath = join(process.cwd(), `attach-diag-${providerId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  console.log(`\n=== ${providerId} ===`);
  console.log(`uploadFileToPage() returned: ${attached}`);
  if (uploadErr) console.log(`  (threw: ${uploadErr})`);
  console.log(`screenshot: ${screenshotPath}`);
  console.log(`\nbefore -> after (a non-zero BEFORE count means that selector`);
  console.log(`cannot distinguish this turn's own attachment from what was`);
  console.log(`already on the page — flagged UNUSABLE, not just reported):`);
  for (const [label] of allSelectors) {
    const b = before[label];
    const a = after[label];
    const flag = b > 0 ? "  UNUSABLE — non-zero before any upload" : "";
    console.log(
      `  ${String(b).padStart(2)} -> ${String(a).padEnd(2)}  ${label}${flag}`,
    );
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
