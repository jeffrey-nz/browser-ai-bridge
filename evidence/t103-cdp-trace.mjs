#!/usr/bin/env node
/**
 * t103-cdp-trace.mjs — T-103. Settles by protocol-level measurement whether
 * a click on chatgpt's upload menu item ("Add photos & files") can ever be
 * intercepted by Playwright's waitForEvent("filechooser"), which is backed
 * by CDP's legacy Page.fileChooserOpened.
 *
 * Phase 0: fresh composer, read the menu item's current label (quota check).
 * Phase 1: CDP session, Page domain enabled, click composer-plus-btn then
 *   the menu item, record every Page.* event (from the full stable event
 *   set) for 5s. Write the raw list to evidence/.
 * Phase 2 (only if Page.fileChooserOpened did not fire in phase 1): shim
 *   window.showOpenFilePicker to record whether it is called, repeat the
 *   click on a fresh composer, report whether the shim fired.
 *
 * Connects to the same running Chrome the live bridge uses (via CDP), same
 * pattern as scripts/attachment-diagnose.mjs.
 */
import { chromium } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";
import { startNewChat } from "../src/ai/chatgpt/interaction/chat.js";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const EVIDENCE_DIR = "evidence";

// The stable (non-experimental) Page domain event names, per the CDP spec —
// this is the "EVERY Page.* event" the acceptance asks for, since Playwright's
// CDPSession requires listening by name rather than exposing a wildcard.
const PAGE_EVENTS = [
  "domContentEventFired",
  "fileChooserOpened",
  "frameAttached",
  "frameDetached",
  "frameNavigated",
  "documentOpened",
  "frameResized",
  "frameRequestedNavigation",
  "frameStartedLoading",
  "frameStoppedLoading",
  "interstitialHidden",
  "interstitialShown",
  "javascriptDialogClosed",
  "javascriptDialogOpening",
  "lifecycleEvent",
  "loadEventFired",
  "navigatedWithinDocument",
  "screencastFrame",
  "screencastVisibilityChanged",
  "windowOpen",
  "compilationCacheProduced",
  "downloadWillBegin",
  "downloadProgress",
];

const PLUS_BTN = '[data-testid="composer-plus-btn"]';
const MENU_ITEM = "div.__menu-item:has-text('Add photos & files')";
const MENU_ITEM_ANY =
  "div.__menu-item:has-text('Add photos & files'), div.__menu-item:has-text('Get Plus for more uploads')";

async function freshComposer(page) {
  await startNewChat(page);
  await page.waitForTimeout(1000);
}

async function readMenuLabel(page) {
  await page.click(PLUS_BTN);
  await page.waitForTimeout(500);
  const item = page.locator(MENU_ITEM_ANY).first();
  const visible = await item.isVisible().catch(() => false);
  const label = visible ? await item.innerText().catch(() => null) : null;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return { visible, label };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();

  await freshComposer(page);

  const quota = await readMenuLabel(page);
  console.log(
    `[phase 0] menu item visible=${quota.visible} label=${JSON.stringify(quota.label)}`,
  );
  if (!quota.visible || !quota.label || quota.label.includes("Get Plus")) {
    console.log(
      "QUOTA CLOSED (or item not found) — measurement not possible right now.",
    );
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(
      `${EVIDENCE_DIR}/t103-quota-closed.json`,
      JSON.stringify({ ts: new Date().toISOString(), quota }, null, 2),
    );
    process.exit(2);
  }

  // ---- Phase 1: CDP trace of the real click ----
  await freshComposer(page);
  const client = await context.newCDPSession(page);
  await client.send("Page.enable");

  const events = [];
  for (const evt of PAGE_EVENTS) {
    client.on(evt, (params) => {
      events.push({ tMs: Date.now(), event: `Page.${evt}`, params });
    });
  }

  const t0 = Date.now();
  await page.click(PLUS_BTN);
  await page.waitForTimeout(400);
  const menuItemVisibleAtClick = await page
    .locator(MENU_ITEM)
    .first()
    .isVisible()
    .catch(() => false);
  await page.click(MENU_ITEM);
  const t1 = Date.now();
  await page.waitForTimeout(5000);
  const t2 = Date.now();

  const fileChooserFired = events.some(
    (e) => e.event === "Page.fileChooserOpened",
  );

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    `${EVIDENCE_DIR}/t103-cdp-trace.json`,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        menuItemVisibleAtClick,
        clickedPlusBtnAt: t0,
        clickedMenuItemAt: t1,
        recordedUntil: t2,
        fileChooserFired,
        events,
      },
      null,
      2,
    ),
  );
  console.log(`[phase 1] events recorded: ${events.length}`);
  console.log(`[phase 1] Page.fileChooserOpened fired: ${fileChooserFired}`);
  console.log(
    `[phase 1] menu item visible at click time: ${menuItemVisibleAtClick}`,
  );
  console.log(
    "[phase 1] event order:",
    events.map((e) => e.event).join(", ") || "(none)",
  );

  if (fileChooserFired) {
    console.log(
      "VERDICT: Page.fileChooserOpened DID fire — a chooser opened. Phase 2 skipped.",
    );
    process.exit(0);
  }

  // ---- Phase 2: showOpenFilePicker shim ----
  await freshComposer(page);
  const shimInstallResult = await page.evaluate(() => {
    window.__t103 = {
      called: false,
      argsJson: null,
      hadOriginal: typeof window.showOpenFilePicker === "function",
    };
    const orig = window.showOpenFilePicker;
    window.showOpenFilePicker = function (...args) {
      window.__t103.called = true;
      try {
        window.__t103.argsJson = JSON.stringify(args);
      } catch {
        window.__t103.argsJson = "(unserializable args)";
      }
      if (typeof orig === "function") return orig.apply(this, args);
      // No original to chain to — return a never-resolving promise so the
      // page doesn't throw and we can still observe the call was made.
      return new Promise(() => {});
    };
    return window.__t103.hadOriginal;
  });
  console.log(
    `[phase 2] window.showOpenFilePicker existed before shim: ${shimInstallResult}`,
  );

  const menuItemVisibleAtClick2 = await (async () => {
    await page.click(PLUS_BTN);
    await page.waitForTimeout(400);
    return page
      .locator(MENU_ITEM)
      .first()
      .isVisible()
      .catch(() => false);
  })();
  await page.click(MENU_ITEM);
  await page.waitForTimeout(5000);

  const shimAfter = await page.evaluate(() => window.__t103);
  console.log(`[phase 2] shim fired: ${shimAfter.called}`);
  if (shimAfter.called) console.log(`[phase 2] args: ${shimAfter.argsJson}`);
  console.log(
    `[phase 2] menu item visible at click time: ${menuItemVisibleAtClick2}`,
  );

  await writeFile(
    `${EVIDENCE_DIR}/t103-shim-result.json`,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        shimInstallResult,
        menuItemVisibleAtClick: menuItemVisibleAtClick2,
        shimAfter,
      },
      null,
      2,
    ),
  );

  if (shimAfter.called) {
    console.log(
      'VERDICT: showOpenFilePicker WAS called — the File System Access theory is CONFIRMED. Strategy 2 is unreachable for chatgpt through waitForEvent("filechooser").',
    );
  } else {
    console.log(
      "VERDICT: neither Page.fileChooserOpened nor showOpenFilePicker fired — the click is not opening any picker by either mechanism.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
