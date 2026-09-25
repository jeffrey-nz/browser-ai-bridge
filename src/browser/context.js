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

      //[[ ONE BUSY TAB MUST NOT CONDEMN THE WHOLE BROWSER.
      //   This raced the timeout against `pages[0].evaluate(() => 1)` as well as
      //   `browser.version()`. `pages[0]` is whichever page happens to be first —
      //   frequently a provider tab streaming a long answer — and a page whose JS
      //   thread is busy does not answer `evaluate` until it is free. The race
      //   then timed out on a perfectly healthy browser and took the hard-reset
      //   path: Chrome killed, every other in-flight session destroyed with it.
      //   Measured on 2026-09-22: 6 hard resets in a single bridge session during
      //   a long generation run, each one losing the turn that was in flight.
      //
      //   `browser.version()` is the real liveness question — it is answered by
      //   the CDP endpoint itself and does not depend on any page's JS thread, so
      //   it alone decides whether to reset. The page probe is still useful as a
      //   signal, so it is kept, but on its own short budget and with its own
      //   result: a page that will not answer is reported as a stuck PAGE, which
      //   the tab janitor can act on, and never as a dead browser. ]]
      const pageProbeMs = Math.min(2000, Math.floor(timeoutMs / 2));
      const probeFirstPage = async () => {
        const pages = internalState.browserContext.pages();
        if (!pages.length) return;
        const stuck = await Promise.race([
          pages[0]
            .evaluate(() => 1)
            .then(() => false)
            .catch(() => false),
          new Promise((resolve) =>
            setTimeout(() => resolve(true), pageProbeMs),
          ),
        ]);
        if (stuck) {
          logger.warn(
            `[Browser] First page did not answer within ${pageProbeMs}ms — busy or stuck. ` +
              "Not treating this as a browser deadlock.",
          );
        }
      };

      await Promise.race([
        (async () => {
          await probeFirstPage();
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
