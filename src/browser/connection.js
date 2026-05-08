// --- FILE START ---
// Relative Path: src/browser/connection.js
import { chromium } from "playwright-core";
import process from "node:process";
import os from "node:os";
import { logger } from "#utils/logger.js";
import { autoLaunchChrome } from "./launcher/index.js";
import { internalState, BrowserState, setBrowserState } from "./state.js";

export async function connectToBrowser(retries = 15) {
  if (internalState.connectionPromise) {
    return await internalState.connectionPromise;
  }

  internalState.connectionPromise = (async () => {
    setBrowserState(BrowserState.CONNECTING);
    const url = process.env.CDP_URL || "http://127.0.0.1:9222";
    let lastErr = null;

    // 1. Initial attempt: check if Chrome is already running
    try {
      const browser = await chromium.connectOverCDP(url, { timeout: 2000 });
      return await finalizeConnection(browser);
    } catch (e) {
      logger.info(
        "[Browser] No existing Chrome found. Launching fresh instance...",
      );
    }

    // 2. Launch Chrome once
    await autoLaunchChrome();

    // 3. Retry connection loop without killing the process every time
    for (let i = 0; i < retries; i++) {
      try {
        logger.info(`[Browser] Connecting to CDP... (${i + 1}/${retries})`);
        const browser = await chromium.connectOverCDP(url, { timeout: 5000 });
        return await finalizeConnection(browser);
      } catch (err) {
        lastErr = err;
        logger.warn(
          `[Browser] Connection attempt ${i + 1} failed: ${err.message}`,
        );
        // Wait longer between retries to give Chrome time to bind the port
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    setBrowserState(BrowserState.DISCONNECTED);
    throw new Error(
      `Failed to connect to browser after ${retries} attempts. Last error: ${lastErr?.message}`,
    );
  })();

  try {
    return await internalState.connectionPromise;
  } catch (e) {
    internalState.connectionPromise = null;
    throw e;
  }
}

async function finalizeConnection(browser) {
  const contexts = browser.contexts();
  const browserContext =
    contexts.length > 0 ? contexts[0] : await browser.newContext();

  await browserContext
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => {});

  // Tell Chrome to save downloads to ~/Downloads rather than showing a dialog
  // or creating undownloadable blob URLs. This must be done via a raw CDP
  // session because Playwright's context options aren't available on an
  // already-existing CDP-connected context.
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: os.homedir() + "/Downloads",
      eventsEnabled: true,
    });
    await cdp.detach().catch(() => {});
    logger.info("[Browser] Download behaviour set → ~/Downloads");
  } catch (err) {
    logger.warn(`[Browser] Could not set download behaviour: ${err.message}`);
  }

  browserContext.setDefaultNavigationTimeout(15000);

  // Close any stale about:blank tabs left over from previous sessions
  const allPages = browserContext.pages();
  const blankPages = allPages.filter((p) => {
    const u = p.url();
    return u === "about:blank" || u === "" || u === "about:newtab";
  });
  if (blankPages.length > 0) {
    logger.info(`[Browser] Closing ${blankPages.length} stale blank tab(s)…`);
    await Promise.allSettled(blankPages.map((p) => p.close()));
  }

  browser.on("disconnected", () => {
    logger.warn("[Browser] CDP disconnected.");
    setBrowserState(BrowserState.DISCONNECTED);
  });

  setBrowserState(BrowserState.CONNECTED, browser, browserContext);
  logger.info(`[Browser] Connected successfully.`);
  return { browser, context: browserContext };
}
