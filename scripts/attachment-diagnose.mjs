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
 * of costing a live session, a revert, and two review round trips.
 *
 * THE UNUSABLE FLAG IS DECIDED BY VISIBILITY, NOT COUNT (T-021). count()
 * counts nodes attached to the DOM; the production code this instrument
 * models — waitForAttachmentEvidence, src/ai/shared/uploadFile.js — decides
 * imageAttached with `.first().waitFor({ state: "visible" })`. Those are
 * different questions: a selector that matches a hidden placeholder
 * (display:none, zero size, an empty template an SPA keeps mounted) before
 * the upload and a real, visible card after it is a perfectly usable
 * evidence selector, and count() alone would flag it UNUSABLE on a false
 * premise — the same selector would correctly report imageAttached:false on
 * an empty composer in production, because waitFor({state:"visible"}) does
 * too. So both count and visibility are measured and printed for every
 * selector, before and after, but only a selector VISIBLE before the upload
 * is flagged unusable — that is the one shape that would make
 * waitForAttachmentEvidence return true on an empty composer. Do not
 * simplify this back to a bare count; that is the exact regression this
 * ticket exists to prevent.
 *
 * Usage: node scripts/attachment-diagnose.mjs <providerId>
 *   providerId: zai | kimi | qwen | mistral | perplexity | chatgpt | deepseek | grok
 */
import { chromium } from "playwright-core";
import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uploadFileToPage,
  DEFAULT_ATTACHMENT_EVIDENCE,
} from "../src/ai/shared/uploadFile.js";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { uploadFileToDeepSeek } from "../src/ai/deepseek/interaction/prompt/input.js";
import { uploadFileToGrok } from "../src/ai/grok/interaction/prompt/input.js";
// T-024: same REPORTS_DIR the audit path writes to (src/audit/io.js), not a
// second hardcoded "reports" string — gitignored, so this script's output
// can never become commit-bait the way a repo-root screenshot was.
import { REPORTS_DIR } from "../src/audit/io.js";

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
    // T-030: forwarded so this script models the SAME call
    // src/ai/generic/interaction.js makes — without it, a provider whose
    // attach button only opens a menu (kimi, mistral) fails here even
    // though the real /api/ask path (which does pass this) succeeds.
    secondClickSelector: spec.attachMenuItem || null,
    // T-031: same reasoning — without this, kimi's own before/after growth
    // check silently reverts to presence-only here, unlike production.
    requireGrowth: spec.requireGrowth || false,
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

  // count() and isVisible() are DIFFERENT QUESTIONS (T-021): count() counts
  // nodes attached to the DOM, but the production code this instrument
  // models — waitForAttachmentEvidence, src/ai/shared/uploadFile.js — decides
  // imageAttached with `.first().waitFor({ state: "visible" })`. A selector
  // that matches a hidden placeholder (display:none, zero size, an empty
  // template an SPA keeps mounted) before the upload and a real visible card
  // after it is a perfectly usable evidence selector — count() alone would
  // flag it UNUSABLE on a false premise. isVisible() is false for a
  // zero-node locator too, so it needs no separate zero-count case.
  const measureAll = async () => {
    const out = {};
    for (const [label, sel] of allSelectors) {
      const loc = page.locator(sel);
      out[label] = {
        count: await loc.count(),
        visible: await loc
          .first()
          .isVisible()
          .catch(() => false),
      };
    }
    return out;
  };

  // BEFORE (T-020): measured on the composer exactly as loaded, before any
  // upload is attempted — this is the number that would have caught
  // .chip-scroll being non-zero on a "fresh" zai composer.
  const before = await measureAll();

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
          secondClickSelector: target.secondClickSelector,
          requireGrowth: target.requireGrowth,
        });
  } catch (err) {
    attached = false;
    uploadErr = err.message;
  }

  const after = await measureAll();
  await mkdir(REPORTS_DIR, { recursive: true });
  const screenshotFilename = `attach-diag-${providerId}.png`;
  const screenshotPath = join(REPORTS_DIR, screenshotFilename);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  console.log(`\n=== ${providerId} ===`);
  console.log(`uploadFileToPage() returned: ${attached}`);
  if (uploadErr) console.log(`  (threw: ${uploadErr})`);
  console.log(`  [IO] Screenshot → ./reports/${screenshotFilename}`);
  console.log(
    `\ncount, visible: before -> after (UNUSABLE is decided by VISIBILITY`,
  );
  console.log(
    `before the upload, not count — that is the measurement production code`,
  );
  console.log(
    `(waitForAttachmentEvidence) actually makes. A selector that is present`,
  );
  console.log(
    `but hidden before the upload is usable; one visible before it is not:`,
  );
  for (const [label] of allSelectors) {
    const b = before[label];
    const a = after[label];
    const flag = b.visible
      ? "  UNUSABLE — already visible before any upload"
      : "";
    console.log(
      `  ${String(b.count).padStart(2)},${String(b.visible).padStart(6)}  ->  ` +
        `${String(a.count).padStart(2)},${String(a.visible).padStart(6)}  ${label}${flag}`,
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
