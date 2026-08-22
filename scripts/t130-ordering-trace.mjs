#!/usr/bin/env node
/**
 * t130-ordering-trace.mjs — T-130. Settles by direct measurement whether any
 * of chatgpt's imageAttached evidence alternatives (blob:, the
 * uploaded-image button, the estuary img, the backend-api/files img) can
 * become visible BEFORE the server has confirmed the upload
 * (POST /backend-api/files's response), on a REAL turn driven through the
 * production /api/ask path (via scripts/vision-probe.mjs as a child
 * process) — not a synthetic call.
 *
 * Attaches a read-only CDP session (Network + no mutation of the page) to
 * the same chatgpt tab the bridge uses, records every
 * Network.requestWillBeSent / Network.responseReceived event whose URL
 * contains "backend-api/files", and polls each evidence selector's match
 * COUNT (not just visibility — same requireGrowth discipline T-047 already
 * uses in production, so a leftover match from an EARLIER turn cannot be
 * mistaken for this turn's own evidence) every 50ms, recording the first
 * timestamp each selector's count exceeds its own pre-turn baseline.
 *
 * Usage: node scripts/t130-ordering-trace.mjs <count> <color> <outJsonPath>
 */
import { chromium } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startNewChat } from "../src/ai/chatgpt/interaction/chat.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

const EVIDENCE = {
  blob: 'img[src^="blob:" i]',
  uploadedImageBtn: 'button[aria-label*="uploaded image" i]',
  estuary: 'img[src*="backend-api/estuary" i]',
  files: 'img[src*="backend-api/files" i]',
};

const count = process.argv[2] || "6";
const color = process.argv[3] || "crimson";
const outPath =
  process.argv[4] || `evidence/t130-ordering-run-${Date.now()}.json`;
const visionProbeOut =
  process.argv[5] ||
  `reports/vision-probe/t130-ordering-run-${Date.now()}.json`;

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();

  // Fresh composer, real function, unmodified — same discipline every
  // other live-verification script on this board uses.
  await startNewChat(page);
  await page.waitForTimeout(1000);

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");

  const t0 = Date.now();
  const networkEvents = [];
  client.on("Network.requestWillBeSent", (p) => {
    if (p.request.url.includes("backend-api/files")) {
      networkEvents.push({
        tMs: Date.now() - t0,
        type: "requestWillBeSent",
        method: p.request.method,
        url: p.request.url,
      });
    }
  });
  client.on("Network.responseReceived", (p) => {
    if (p.response.url.includes("backend-api/files")) {
      networkEvents.push({
        tMs: Date.now() - t0,
        type: "responseReceived",
        status: p.response.status,
        url: p.response.url,
      });
    }
  });

  // Baseline count for each evidence alternative, taken on the fresh
  // composer BEFORE the turn starts — same requireGrowth semantics
  // uploadFile.js itself uses, so a stale match from before this run
  // cannot register as "this turn's" evidence.
  const baseline = {};
  for (const [key, sel] of Object.entries(EVIDENCE)) {
    baseline[key] = await page
      .locator(sel)
      .count()
      .catch(() => 0);
  }

  const firstGrowthMs = {};
  let polling = true;
  const pollPromise = (async () => {
    while (polling) {
      for (const [key, sel] of Object.entries(EVIDENCE)) {
        if (firstGrowthMs[key] != null) continue;
        const n = await page
          .locator(sel)
          .count()
          .catch(() => baseline[key]);
        if (n > baseline[key]) firstGrowthMs[key] = Date.now() - t0;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  })();

  console.log(
    `[t130] baseline counts: ${JSON.stringify(baseline)} — starting real turn via vision-probe.mjs (count=${count} color=${color})`,
  );
  await mkdir("reports/vision-probe", { recursive: true });
  const child = spawn(
    "node",
    [
      "scripts/vision-probe.mjs",
      "--providers",
      "chatgpt",
      "--count",
      String(count),
      "--color",
      String(color),
      "--out",
      visionProbeOut,
    ],
    { stdio: "inherit" },
  );
  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  // Let any late DOM/network settle after the probe process reports done.
  await new Promise((r) => setTimeout(r, 2000));
  polling = false;
  await pollPromise;

  await mkdir("evidence", { recursive: true });
  const result = {
    ts: new Date().toISOString(),
    visionProbeExitCode: exitCode,
    visionProbeOut,
    baseline,
    networkEvents,
    firstEvidenceGrowthMs: firstGrowthMs,
  };
  await writeFile(outPath, JSON.stringify(result, null, 2));

  console.log(
    `[t130] network events: ${JSON.stringify(networkEvents, null, 2)}`,
  );
  console.log(
    `[t130] first evidence GROWTH (ms from t0, null = never grew): ${JSON.stringify(firstGrowthMs, null, 2)}`,
  );
  console.log(`[t130] trace written to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
