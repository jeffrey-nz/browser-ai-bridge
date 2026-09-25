#!/usr/bin/env node
// @one-shot-probe — closed-ticket evidence script, not meant to be re-run generally (T-085). Excluded from scripts/doc-check.mjs's bucket-one requirement by this marker, not by a hardcoded name.
/**
 * T-031 evidence-gathering probe. Connects to the live kimi tab over CDP —
 * the same shared Chrome the bridge drives — and directly exercises the REAL
 * production functions (uploadFileToPage from src/ai/shared/uploadFile.js,
 * startNewChat from src/ai/generic/interaction.js, with kimi's real
 * spec.attachEvidence/requireGrowth from src/ai/generic/specs.js) against a
 * stuck-attachment DOM state.
 *
 * Live-reproducing the interrupted-upload trap from scratch (a genuinely
 * successful kimi upload whose SEND never fires, e.g. a mid-turn client
 * disconnect) needs a real navigator-level abort at the right instant, which
 * is not cheaply or deterministically reachable via curl. What matters for
 * verifying the FIX is the DOM shape it defends against, not how that shape
 * gets there — a leftover node matching spec.attachEvidence that predates
 * this call's own upload attempt — so this script injects that shape
 * directly when the page happens to be clean. The FIRST time this ran,
 * kimi's account already carried a real one (see
 * reports/vision-probe/t031-kimi-growth-check.json, run1) — the synthetic
 * path only exists so the check is still runnable once that's cleaned up.
 */
import { chromium } from "playwright-core";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFileToPage } from "../src/ai/shared/uploadFile.js";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { makeInteraction } from "../src/ai/generic/interaction.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const spec = GENERIC_SPECS.kimi;

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => spec.urlMatch(p.url()));
  if (!page) {
    page = await context.newPage();
  }
  await page.goto(spec.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  console.log(`tab loaded: ${page.url()}`);

  // --- STEP 1: what's actually on the page BEFORE this script touches
  // anything. If this is nonzero on a freshly-navigated tab, kimi is
  // persisting an unsent draft the same way T-014 found for zai — a REAL
  // stuck node, not a hypothetical one.
  const preExisting = await page.locator(spec.attachEvidence).count();
  console.log(
    `\n[pre-existing state] fresh navigation, ${spec.attachEvidence} count = ${preExisting}`,
  );
  if (preExisting > 0) {
    const html = await page
      .locator(spec.attachEvidence)
      .first()
      .evaluate((el) => el.outerHTML)
      .catch(() => "(could not read)");
    console.log(`  first match outerHTML: ${html}`);

    // Real leftover found on a fresh navigation — test the actual "New Chat"
    // SPA button (production's own startNewChat(), not page.goto) against it,
    // live, right now: does clicking it clear this node or not?
    const { startNewChat } = makeInteraction(spec);
    await startNewChat(page);
    const afterNewChat = await page.locator(spec.attachEvidence).count();
    console.log(
      `  after real startNewChat() click: ${spec.attachEvidence} count = ${afterNewChat} ` +
        `(${afterNewChat > 0 ? "SURVIVED New Chat, confirming the ticket's finding live" : "cleared by New Chat"})`,
    );
  }

  // --- STEP 2: if the page came up clean, inject a synthetic STALE
  // success-thumbnail node so the rest of this probe still has a stale node
  // to test requireGrowth against — same shape spec.js documents as "just as
  // sticky" as the error case (an unsent SUCCESS thumbnail surviving New Chat).
  if (preExisting === 0) {
    const injected = await page.evaluate((sel) => {
      const container =
        document.querySelector(".chat-editor-attachment-area") ||
        document.querySelector('[contenteditable="true"]')?.parentElement ||
        document.body;
      const el = document.createElement("div");
      el.className = "image-thumbnail success t031-synthetic-stale-node";
      container.appendChild(el);
      return { appended: true, matches: document.querySelectorAll(sel).length };
    }, spec.attachEvidence);
    console.log(
      `[inject] preExisting was 0 — added synthetic stale node, DOM now matches: ${injected.matches}`,
    );
  }

  // --- STEP 3: OLD BEHAVIOUR (requireGrowth: false / presence-only) against
  // this DOM state, with NO new upload attempted at all — mirrors "later
  // turn uploaded nothing new, presence-only check still fires true".
  const presenceOnlyMatch =
    (await page.locator(spec.attachEvidence).count()) > 0;
  console.log(
    `\n[presence-only, no new upload attempted] ${spec.attachEvidence} count > 0 = ${presenceOnlyMatch} ` +
      `(this is what waitForAttachmentEvidence()/verify() returns with requireGrowth unset — ` +
      `the stale node alone satisfies it, which is the T-031 bug)`,
  );

  // --- STEP 4: NEW BEHAVIOUR — call the REAL uploadFileToPage() with
  // requireGrowth: true and a malformed/too-small PNG (same shape T-030 lived
  // through), attemptBtnSelector/attachMenuItem/attachEvidence taken straight
  // from kimi's real spec — this is production's own call shape, not a
  // reimplementation.
  const dir = await mkdtemp(join(tmpdir(), "t031-badupload-"));
  const filePath = join(dir, "toosmall.png");
  // Valid PNG signature + truncated IHDR — decodable as "a PNG" by
  // extension/magic bytes, not renderable — same file shape used in the live
  // /api/ask reproduction earlier this session.
  await writeFile(filePath, Buffer.from("iVBORw0KGgoAAAANSUhEUg==", "base64"));

  let result, err;
  try {
    result = await uploadFileToPage(page, filePath, {
      attachmentBtnSelector: spec.attachBtn,
      verifySelector: spec.attachEvidence,
      secondClickSelector: spec.attachMenuItem,
      requireGrowth: spec.requireGrowth,
      verifyTimeoutMs: 4000,
    });
  } catch (e) {
    err = e.message;
  }
  console.log(
    `\n[uploadFileToPage WITH requireGrowth:${spec.requireGrowth}, malformed file, stale node present] ` +
      `returned: ${result}${err ? `  (threw: ${err})` : ""} (expect false — this turn's own upload landed nothing new)`,
  );

  // --- STEP 5: remove whatever is left (synthetic node, or the real leftover
  // if it's still there) via a hard navigation — the one thing T-031's filer
  // confirmed DOES clear it — then confirm the page is genuinely clean.
  await page.evaluate(() => {
    document
      .querySelectorAll(".t031-synthetic-stale-node")
      .forEach((n) => n.remove());
  });
  await page.goto(spec.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);
  const afterHardReload = await page.locator(spec.attachEvidence).count();
  console.log(
    `\n[cleanup via hard reload] ${spec.attachEvidence} count = ${afterHardReload} (expect 0)`,
  );

  console.log("\n=== SUMMARY ===");
  console.log(
    `presence-only (old behaviour) on stale node: ${presenceOnlyMatch}`,
  );
  console.log(
    `requireGrowth (fixed behaviour) on stale node + failed new upload: ${result}`,
  );
  console.log(
    presenceOnlyMatch === true && result === false
      ? "PASS — fix demonstrated: presence-only would have false-positived, requireGrowth correctly does not."
      : "UNEXPECTED — re-check manually.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
