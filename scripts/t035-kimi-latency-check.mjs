#!/usr/bin/env node
/**
 * T-035 evidence-gathering probe. verifyTimeoutMs for kimi's requireGrowth
 * poll (uploadFile.js) is the inherited 6000ms default — nobody has measured
 * what an UNTHROTTLED kimi upload actually takes. This script runs N real,
 * unthrottled uploads of a real valid image through the real
 * uploadFileToPage(), each against a fresh navigation, and records:
 *
 *   - returnedAtMs: when uploadFileToPage() itself returned (its own
 *     verify() poll samples every 300ms, so this is within ~300ms of the
 *     true growth instant)
 *   - growthAtMs: an INDEPENDENT watcher polling every 100ms starting at the
 *     same t0, recording the first instant count > baseline — this is not
 *     gated by verifyTimeoutMs at all, so it still reports a number even on
 *     a run where uploadFileToPage gives up and returns false.
 *
 * verifyTimeoutMs is set generously high (30000ms) for THIS SCRIPT ONLY so a
 * slow real run isn't cut short before it can be measured — production's own
 * default is what clause 2 of T-035 sets from this data, not this script.
 *
 * Each run navigates to a fresh kimi.ai tab. Kimi persists unsent success
 * thumbnails against the ACCOUNT (T-031's unplanned finding), so later runs'
 * baseline can be nonzero from earlier runs in this same script — that's
 * fine, requireGrowth's own baseline is always "count when THIS call
 * started", exactly as production computes it, so each run is still a valid
 * independent measurement.
 */
import { chromium } from "playwright-core";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { uploadFileToPage } from "../src/ai/shared/uploadFile.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const spec = GENERIC_SPECS.kimi;
const RUNS = Number(process.env.T035_RUNS) || 6;
const VALID_IMAGE_PATH =
  process.env.T035_IMAGE || "reports/vision-probe/probe-1787313682148.png";

async function runOnce(page, label) {
  await page.goto(spec.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);

  const baseline = await page.locator(spec.attachEvidence).count();
  console.log(
    `[${label}] fresh nav, baseline ${spec.attachEvidence} count: ${baseline}`,
  );

  const t0 = Date.now();
  let watching = true;
  let growthAtMs = null;
  const watcher = (async () => {
    while (watching) {
      const c = await page.locator(spec.attachEvidence).count();
      if (c > baseline) {
        growthAtMs = Date.now() - t0;
        return;
      }
      await page.waitForTimeout(100);
    }
  })();

  let result, err;
  try {
    result = await uploadFileToPage(page, VALID_IMAGE_PATH, {
      attachmentBtnSelector: spec.attachBtn,
      verifySelector: spec.attachEvidence,
      secondClickSelector: spec.attachMenuItem,
      requireGrowth: spec.requireGrowth,
      verifyTimeoutMs: 30000,
    });
  } catch (e) {
    err = e.message;
  }
  const returnedAtMs = Date.now() - t0;

  // Give the watcher a little longer to catch growth even if
  // uploadFileToPage already returned (e.g. it returned false but the
  // upload actually lands a moment later — same shape T-034 documented).
  const extraWait = Date.now() + 5000;
  while (watching && growthAtMs === null && Date.now() < extraWait) {
    await page.waitForTimeout(150);
  }
  watching = false;
  await watcher;

  const finalCount = await page.locator(spec.attachEvidence).count();
  console.log(
    `[${label}] uploadFileToPage returned: ${result}${err ? `  (threw: ${err})` : ""} at ${returnedAtMs}ms; ` +
      `independent watcher saw growth at ${growthAtMs}ms; finalCount ${finalCount} (baseline ${baseline})`,
  );

  return {
    label,
    baseline,
    result,
    err: err || null,
    returnedAtMs,
    growthAtMs,
    finalCount,
  };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => spec.urlMatch(p.url()));
  if (!page) page = await context.newPage();

  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = await runOnce(page, `run${i}`);
    results.push(r);
  }

  const successful = results.filter((r) => r.growthAtMs !== null);
  const failed = results.filter((r) => r.growthAtMs === null);
  const growthTimes = successful.map((r) => r.growthAtMs);

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  if (growthTimes.length > 0) {
    console.log(
      `\n${successful.length}/${results.length} runs grew. min=${Math.min(...growthTimes)}ms max=${Math.max(...growthTimes)}ms`,
    );
  }
  if (failed.length > 0) {
    console.log(
      `${failed.length} run(s) NEVER grew within the watch window — reported, not dropped.`,
    );
  }

  console.log(
    "\nRAW_JSON_START\n" + JSON.stringify({ runs: results }) + "\nRAW_JSON_END",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
