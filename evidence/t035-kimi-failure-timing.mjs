#!/usr/bin/env node
// @one-shot-probe — closed-ticket evidence script, not meant to be re-run generally (T-085). Excluded from scripts/doc-check.mjs's bucket-one requirement by this marker, not by a hardcoded name.
/**
 * T-035 clause 3: measure the FAILURE path cost of requireGrowth's poll —
 * a stale .image-thumbnail.success node present, and a malformed file (same
 * fixture T-031 used) that lands an ERROR thumbnail, never a new SUCCESS
 * one, so verify() never sees count > baseline. Times the whole
 * uploadFileToPage() call (there's no separate export for verify() alone),
 * against both:
 *   - PRE-T-034 code (c674de8, the T-031 state): waitForAttachmentEvidence()
 *     first-visible-satisfied-by-the-stale-node, THEN one count sample.
 *   - POST-T-034 code (current, 44b2e29): polls count > baseline for the
 *     full verifyTimeoutMs.
 * Both runs use kimi's real spec, unthrottled, default verifyTimeoutMs
 * (whatever LABEL's checked-out uploadFile.js has — 6000ms for both, since
 * this script runs before T-035 sets kimi's own override).
 */
import { chromium } from "playwright-core";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { uploadFileToPage } from "../src/ai/shared/uploadFile.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const spec = GENERIC_SPECS.kimi;
const LABEL = process.env.T035_LABEL || "run";

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => spec.urlMatch(p.url()));
  if (!page) page = await context.newPage();
  await page.goto(spec.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);

  const preExisting = await page.locator(spec.attachEvidence).count();
  console.log(
    `[${LABEL}] pre-existing ${spec.attachEvidence} count: ${preExisting}`,
  );
  if (preExisting === 0) {
    await page.evaluate((sel) => {
      const container =
        document.querySelector(".chat-editor-attachment-area") ||
        document.querySelector('[contenteditable="true"]')?.parentElement ||
        document.body;
      const el = document.createElement("div");
      el.className = "image-thumbnail success t035-synthetic-stale-node";
      container.appendChild(el);
    }, spec.attachEvidence);
  }
  const baseline = await page.locator(spec.attachEvidence).count();
  console.log(`[${LABEL}] baseline (stale node present): ${baseline}`);

  const dir = await mkdtemp(join(tmpdir(), "t035-badupload-"));
  const filePath = join(dir, "toosmall.png");
  await writeFile(filePath, Buffer.from("iVBORw0KGgoAAAANSUhEUg==", "base64"));

  const t0 = Date.now();
  let result, err;
  try {
    result = await uploadFileToPage(page, filePath, {
      attachmentBtnSelector: spec.attachBtn,
      verifySelector: spec.attachEvidence,
      secondClickSelector: spec.attachMenuItem,
      requireGrowth: spec.requireGrowth,
      // deliberately NOT overriding verifyTimeoutMs — this is the inherited
      // default the ticket is about.
    });
  } catch (e) {
    err = e.message;
  }
  const elapsedMs = Date.now() - t0;
  const finalCount = await page.locator(spec.attachEvidence).count();
  console.log(
    `[${LABEL}] uploadFileToPage(malformed file, stale node present) returned: ${result}` +
      `${err ? `  (threw: ${err})` : ""} after ${elapsedMs}ms; finalCount ${finalCount} (baseline ${baseline}, expect no growth)`,
  );

  await page.evaluate(() => {
    document
      .querySelectorAll(".t035-synthetic-stale-node")
      .forEach((n) => n.remove());
  });

  console.log(
    `\n[${LABEL}] SUMMARY: result=${result} elapsedMs=${elapsedMs} finalCount=${finalCount} baseline=${baseline}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
