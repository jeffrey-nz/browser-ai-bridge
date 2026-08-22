#!/usr/bin/env node
// @one-shot-probe — closed-ticket evidence script, not meant to be re-run generally (T-085). Excluded from scripts/doc-check.mjs's bucket-one requirement by this marker, not by a hardcoded name.
/**
 * T-034 evidence-gathering probe. Same CDP-over-the-shared-Chrome approach
 * as scripts/t031-growth-check.mjs, but this one tests the TIMING of
 * requireGrowth rather than its outcome on a no-op upload: a stale
 * .image-thumbnail.success node is injected first, then a REAL, VALID image
 * is uploaded through the real uploadFileToPage(). The question is not
 * "does the count grow" (T-031 already answered that for a malformed file)
 * but "does verify() wait long enough to SEE it grow" — a stale node already
 * visible satisfies waitForAttachmentEvidence()'s first-visible wait
 * instantly, so the pre-T-034 code sampled the count once, immediately,
 * long before a real network upload had any chance to land.
 *
 * Run against the git-stashed PRE-fix uploadFile.js first (failing-first
 * evidence), then again against the fixed version, to get both halves of
 * the acceptance in one script.
 */
import { chromium } from "playwright-core";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { uploadFileToPage } from "../src/ai/shared/uploadFile.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const spec = GENERIC_SPECS.kimi;
const LABEL = process.env.T034_LABEL || "run";

// A genuinely valid image kimi actually accepts. The 1x1 fixture used
// elsewhere in this repo (scripts/attachment-diagnose.mjs) turned out to be
// too degenerate for kimi specifically — it renders as an ERROR thumbnail
// there, discovered while running this very probe. Use a real vision-probe
// fixture (a proper colour-square image, already live-verified reaching
// .image-thumbnail.success on kimi in T-030 — reports/vision-probe/
// t030-kimi-run1.json names this exact file) instead.
const VALID_IMAGE_PATH =
  process.env.T034_IMAGE || "reports/vision-probe/probe-1787313682148.png";

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => spec.urlMatch(p.url()));
  if (!page) page = await context.newPage();
  await page.goto(spec.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  console.log(`[${LABEL}] tab loaded: ${page.url()}`);

  const preExisting = await page.locator(spec.attachEvidence).count();
  console.log(
    `[${LABEL}] pre-existing ${spec.attachEvidence} count: ${preExisting}`,
  );
  if (preExisting > 0) {
    throw new Error(
      "page already has real leftover attachments — clean it up (see T-031's delete-icon script) before running this probe",
    );
  }

  // Inject the synthetic stale node — same shape T-031's own probe uses.
  await page.evaluate((sel) => {
    const container =
      document.querySelector(".chat-editor-attachment-area") ||
      document.querySelector('[contenteditable="true"]')?.parentElement ||
      document.body;
    const el = document.createElement("div");
    el.className = "image-thumbnail success t034-synthetic-stale-node";
    container.appendChild(el);
  }, spec.attachEvidence);
  const baseline = await page.locator(spec.attachEvidence).count();
  console.log(
    `[${LABEL}] injected synthetic stale node, baseline count: ${baseline}`,
  );

  const filePath = VALID_IMAGE_PATH;

  // Throttle the network so the REAL upload's own round trip reliably lands
  // after the mechanical steps (click, menu, chooser) — otherwise this is a
  // genuine race that can go either way depending on how long kimi's own
  // click/menu handling happens to take on a given run (observed both
  // outcomes across runs before adding this). Still a real upload through
  // the real uploadFileToPage() on a real file — just slow, not simulated.
  if (process.env.T034_THROTTLE !== "0") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (50 * 1024) / 8,
      uploadThroughput: (20 * 1024) / 8,
      latency: 1500,
    });
    console.log(`[${LABEL}] network throttled (20kbps up, 1.5s latency)`);
  }

  const t0 = Date.now();
  let result, err;
  try {
    result = await uploadFileToPage(page, filePath, {
      attachmentBtnSelector: spec.attachBtn,
      verifySelector: spec.attachEvidence,
      secondClickSelector: spec.attachMenuItem,
      requireGrowth: spec.requireGrowth,
      // Generous on purpose: this run's job is to prove the POLL LOGIC is
      // correct once it's given enough time, not to pin down kimi's actual
      // production latency (production keeps the spec/option default).
      verifyTimeoutMs: Number(process.env.T034_VERIFY_TIMEOUT_MS) || 20000,
    });
  } catch (e) {
    err = e.message;
  }
  const returnedAtMs = Date.now() - t0;
  const countAtReturn = await page.locator(spec.attachEvidence).count();
  console.log(
    `\n[${LABEL}] uploadFileToPage(valid file, stale node present) returned: ${result}` +
      `${err ? `  (threw: ${err})` : ""} after ${returnedAtMs}ms; ` +
      `count at that instant: ${countAtReturn} (baseline ${baseline})`,
  );

  // Keep watching AFTER the call returned — if count reaches baseline+1
  // some time later, the upload was genuinely real and valid; whether
  // uploadFileToPage's own return value already reflected that or not is
  // exactly what this ticket is about.
  const watchUntil = Date.now() + 15000;
  let grewAtMs = null;
  while (Date.now() < watchUntil) {
    const c = await page.locator(spec.attachEvidence).count();
    if (c > baseline) {
      grewAtMs = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(300);
  }
  console.log(
    grewAtMs !== null
      ? `[${LABEL}] count reached baseline+1 at ${grewAtMs}ms (${grewAtMs > returnedAtMs ? "AFTER" : "before/at"} uploadFileToPage returned at ${returnedAtMs}ms)`
      : `[${LABEL}] count never exceeded baseline within the 15s watch window`,
  );

  const finalCount = await page.locator(spec.attachEvidence).count();
  console.log(`[${LABEL}] final count: ${finalCount} (baseline ${baseline})`);

  console.log(
    `\n[${LABEL}] SUMMARY: result=${result} returnedAtMs=${returnedAtMs} grewAtMs=${grewAtMs} finalCount=${finalCount} baseline=${baseline}`,
  );

  // Cleanup: remove synthetic node + any real thumbnail this run added, via
  // a hard reload (T-031 confirmed this clears synthetic/DOM-only state;
  // a genuinely-landed real upload needs its own delete-icon click, done
  // separately after inspecting the results of this run).
  await page.evaluate(() => {
    document
      .querySelectorAll(".t034-synthetic-stale-node")
      .forEach((n) => n.remove());
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
