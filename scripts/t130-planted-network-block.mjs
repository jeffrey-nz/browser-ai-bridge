#!/usr/bin/env node
/**
 * t130-planted-network-block.mjs — T-130 clause 3. Deliberately blocks
 * POST /backend-api/files at the CDP Network layer BEFORE a real chatgpt
 * turn, then runs the turn through the unmodified production path
 * (scripts/vision-probe.mjs --planted-break) to see whether
 * imageAttached/its evidence still reads true when the upload cannot
 * possibly reach the server. This is a plant in this board's established
 * sense (T-128/ia-grade's PLANTED block) — the report's plantedBreak field
 * names exactly what was blocked and why.
 *
 * Usage: node scripts/t130-planted-network-block.mjs <count> <color> <outJsonPath>
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { startNewChat } from "../src/ai/chatgpt/interaction/chat.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const count = process.argv[2] || "6";
const color = process.argv[3] || "crimson";
const outPath =
  process.argv[4] ||
  `reports/vision-probe/t130-planted-network-block-${Date.now()}.json`;

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();

  await startNewChat(page);
  await page.waitForTimeout(1000);

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.setBlockedURLs", {
    urls: ["*backend-api/files*"],
  });
  console.log("[t130] blocked *backend-api/files* at the CDP Network layer");

  let blockedRequestSeen = false;
  client.on("Network.loadingFailed", (p) => {
    if (p.errorText === "net::ERR_BLOCKED_BY_CLIENT") {
      blockedRequestSeen = true;
      console.log(
        `[t130] confirmed a request was actually blocked: ${p.type} ${p.requestId}`,
      );
    }
  });

  const plantedBreak = `T-130: blocked POST */backend-api/files* via CDP Network.setBlockedURLs BEFORE the turn — tests whether chatgpt's evidence selectors (blob:/uploaded-image button) still read imageAttached:true when the upload cannot reach the server at all`;

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
      "--planted-break",
      plantedBreak,
      "--out",
      outPath,
    ],
    { stdio: "inherit" },
  );
  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  // Unblock immediately after, so the tab is left usable for anything else.
  await client.send("Network.setBlockedURLs", { urls: [] });
  console.log("[t130] unblocked *backend-api/files* — restored");

  console.log(`[t130] vision-probe exit code: ${exitCode}`);
  console.log(
    `[t130] a request was actually intercepted/blocked: ${blockedRequestSeen}`,
  );
  console.log(`[t130] report written to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
