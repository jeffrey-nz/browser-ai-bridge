#!/usr/bin/env node
/**
 * T-036 evidence-gathering probe. T-035's own latency data showed kimi's
 * persisted .image-thumbnail.success count climbing 0..8 across two batches
 * and then holding at 8 for three consecutive fresh-navigation runs. This
 * script:
 *
 *   Phase A: builds the account up to a baseline >= 7 (skipped if already
 *     there) via real uploads through the real uploadFileToPage().
 *   Phase B (clause 1): 5 consecutive cycles of fresh-nav -> count ->
 *     real upload -> fresh-nav -> count, starting from that >=7 baseline.
 *     Reports every count in order.
 *   Phase C (clause 2): at whatever the plateau turns out to be, on a fresh
 *     navigation, counts BOTH ".image-thumbnail" (bare) and
 *     ".image-thumbnail.success" (spec.attachEvidence) to separate
 *     "nodes survive but lose .success" from "the strip itself caps".
 *   Phase D (clause 3): one call through the REAL uploadFileToPage() with
 *     kimi's REAL spec options (requireGrowth true, verifyTimeoutMs taken
 *     from the spec itself, NOT overridden), starting from the plateau,
 *     uploading a real valid image. Reports the returned boolean and
 *     elapsed ms.
 *
 * Same fixture used throughout T-030/T-034/T-035:
 * reports/vision-probe/probe-1787313682148.png (a real colour-square PNG,
 * live-confirmed reaching .image-thumbnail.success on kimi).
 */
import { chromium } from "playwright-core";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";
import { uploadFileToPage } from "../src/ai/shared/uploadFile.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const spec = GENERIC_SPECS.kimi;
const VALID_IMAGE_PATH =
  process.env.T036_IMAGE || "reports/vision-probe/probe-1787313682148.png";
const TARGET_BASELINE = Number(process.env.T036_TARGET_BASELINE) || 7;
const CYCLES = Number(process.env.T036_CYCLES) || 5;

async function freshNav(page) {
  await page.goto(spec.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
}

async function countSuccess(page) {
  return page.locator(spec.attachEvidence).count();
}

async function uploadOnce(page, verifyTimeoutMs) {
  const t0 = Date.now();
  let result, err;
  try {
    result = await uploadFileToPage(page, VALID_IMAGE_PATH, {
      attachmentBtnSelector: spec.attachBtn,
      verifySelector: spec.attachEvidence,
      secondClickSelector: spec.attachMenuItem,
      requireGrowth: spec.requireGrowth,
      verifyTimeoutMs,
    });
  } catch (e) {
    err = e.message;
  }
  const elapsedMs = Date.now() - t0;
  return { result, err: err || null, elapsedMs };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  let page = pages.find((p) => spec.urlMatch(p.url()));
  if (!page) page = await context.newPage();

  const out = { providerId: "kimi" };

  // ---- Phase A: build up to baseline >= TARGET_BASELINE ----
  await freshNav(page);
  let count = await countSuccess(page);
  console.log(`[phaseA] starting count: ${count}`);
  const buildupLog = [];
  while (count < TARGET_BASELINE) {
    const r = await uploadOnce(page, 30000);
    await freshNav(page);
    count = await countSuccess(page);
    buildupLog.push({ ...r, countAfter: count });
    console.log(
      `[phaseA] uploaded -> result=${r.result} elapsedMs=${r.elapsedMs} countAfter=${count}`,
    );
  }
  out.phaseA_buildup = {
    description: `Uploaded real valid images one at a time (fresh nav between each) until baseline reached ${TARGET_BASELINE}. Empty if the account was already at/above target when this script started.`,
    startingCount: buildupLog.length > 0 ? buildupLog[0].countAfter - 1 : count,
    log: buildupLog,
    finalCount: count,
  };

  // ---- Phase B (clause 1): 5 consecutive fresh-nav -> count -> upload -> fresh-nav -> count cycles ----
  const cycles = [];
  for (let i = 1; i <= CYCLES; i++) {
    await freshNav(page);
    const preCount = await countSuccess(page);
    const r = await uploadOnce(page, 30000);
    await freshNav(page);
    const postCount = await countSuccess(page);
    const cycle = {
      cycle: i,
      preCount,
      uploadResult: r.result,
      uploadErr: r.err,
      uploadElapsedMs: r.elapsedMs,
      postCount,
    };
    cycles.push(cycle);
    console.log(
      `[phaseB cycle${i}] preCount=${preCount} uploadResult=${r.result} (${r.elapsedMs}ms) postCount=${postCount}`,
    );
  }
  const allCounts = cycles.flatMap((c) => [c.preCount, c.postCount]);
  const highestObserved = Math.max(...allCounts);
  out.clause1_plateauCheck = {
    scriptUsed: "scripts/t036-kimi-plateau-check.mjs",
    description:
      "5 consecutive cycles of fresh-nav -> count(.image-thumbnail.success) -> real upload via real uploadFileToPage() (requireGrowth:true, verifyTimeoutMs:30000 for this measurement only, generous so a slow real upload isn't cut short before it can be observed) -> fresh-nav -> count again. Starting baseline was built up to >= 7 in phaseA above.",
    cycles,
    allCountsInOrder: allCounts,
    highestObserved,
    everExceeded8: highestObserved > 8,
  };

  // ---- Phase C (clause 2): at the plateau, compare bare vs .success counts on a fresh nav ----
  await freshNav(page);
  const bareCount = await page.locator(".image-thumbnail").count();
  const successCount = await countSuccess(page);
  out.clause2_bareVsSuccess = {
    description:
      "At the plateau, fresh navigation, both counts read on the SAME loaded page.",
    bareCount_allThumbnails: bareCount,
    successCount_specSelector: successCount,
    nodesSurviveButLoseClass: bareCount > successCount,
    stripItselfCaps: bareCount === successCount,
  };
  console.log(
    `[phaseC] bare=${bareCount} success=${successCount} (${bareCount > successCount ? "nodes survive, lose .success" : "caps together"})`,
  );

  // ---- Phase D (clause 3): real uploadFileToPage(), kimi's real spec, unmodified ----
  const clause3Options = {
    attachmentBtnSelector: spec.attachBtn,
    verifySelector: spec.attachEvidence,
    secondClickSelector: spec.attachMenuItem,
    requireGrowth: spec.requireGrowth,
    verifyTimeoutMs: spec.verifyTimeoutMs,
  };
  console.log(
    `[phaseD] calling uploadFileToPage with UNMODIFIED spec options: ${JSON.stringify(clause3Options)}`,
  );
  const t0 = Date.now();
  let result, err;
  try {
    result = await uploadFileToPage(page, VALID_IMAGE_PATH, clause3Options);
  } catch (e) {
    err = e.message;
  }
  const elapsedMs = Date.now() - t0;
  const countAfter = await countSuccess(page);
  out.clause3_productionCall = {
    description:
      "One call through the REAL uploadFileToPage() with kimi's REAL production spec options (requireGrowth: spec.requireGrowth, verifyTimeoutMs: spec.verifyTimeoutMs read directly off GENERIC_SPECS.kimi, not overridden), starting from the plateau, uploading the same confirmed-landing image used throughout T-030/T-034/T-035.",
    optionsUsed: clause3Options,
    returned: result,
    err: err || null,
    elapsedMs,
    countBefore: successCount,
    countAfter,
    visuallyLanded: countAfter > successCount,
  };
  console.log(
    `[phaseD] returned=${result} elapsedMs=${elapsedMs} countBefore=${successCount} countAfter=${countAfter}`,
  );

  console.log("\nRAW_JSON_START\n" + JSON.stringify(out) + "\nRAW_JSON_END");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
