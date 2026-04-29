import { logger } from "#utils/logger.js";
import { internalState, BrowserState, setBrowserState } from "./state.js";
import { connectToBrowser } from "./connection.js";
import { killBrowserProcess } from "./launcher/index.js";

export async function getBrowserContext() {
  if (
    internalState.status === BrowserState.CONNECTED &&
    internalState.browserContext &&
    internalState.browser?.isConnected()
  ) {
    try {
      const timeoutMs = (() => {
        const envVal = process.env.BROWSER_DEADLOCK_TIMEOUT_MS;
        if (envVal !== undefined) {
          const parsed = parseInt(envVal, 10);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        return 10000;
      })();

      await Promise.race([
        (async () => {
          const pages = internalState.browserContext.pages();
          if (pages.length > 0) {
            await pages[0].evaluate(() => 1).catch(() => {});
          }

          await internalState.browser.version();
        })(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Browser JS thread or CDP deadlock")),
            timeoutMs,
          ),
        ),
      ]);

      return {
        browser: internalState.browser,
        context: internalState.browserContext,
      };
    } catch (e) {
      logger.error(
        `[Browser] Existing context unresponsive (${e.message}). Forcing hard reset...`,
      );

      try {
        internalState.browser.close().catch(() => {});
      } catch (err) {}

      setBrowserState(BrowserState.DISCONNECTED);
      await killBrowserProcess();
    }
  }

  return await connectToBrowser();
}

export function assertBrowserReady() {
  if (
    internalState.status !== BrowserState.CONNECTED ||
    !internalState.browserContext ||
    !internalState.browser?.isConnected()
  ) {
    throw new Error("Browser not connected or unresponsive");
  }
}
