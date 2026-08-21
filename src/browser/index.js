import { internalState } from "./state.js";
import { killBrowserProcess } from "./launcher/index.js";

export {
  BrowserState,
  internalState as browserInternalState,
} from "./state.js";
export { connectToBrowser } from "./connection.js";
export { getBrowserContext, assertBrowserReady } from "./context.js";
export {
  autoLaunchChrome,
  killBrowserProcess,
  shouldKillOwnChromeOnShutdown,
} from "./launcher/index.js";

export const getBrowserState = () => internalState.status;

/**
 * Clean up browser resources: close Playwright connection and kill Chrome process.
 * Should be called during shutdown to prevent zombie processes.
 */
export async function cleanupBrowser() {
  // Only touch Chrome if THIS process actually connected to or launched one —
  // internalState.browser (a live connection) or internalState.chromePid (a
  // process this instance spawned). Without this guard, a short-lived script
  // that merely imports this module (e.g. a test file that never calls
  // connectToBrowser()/getBrowserContext()) would kill whatever is listening
  // on the CDP port on exit via killBrowserProcess()'s untracked-PID fallback
  // — which for a script running alongside a live bridge server is that
  // server's shared Chrome instance, not anything this process owns.
  if (!internalState.browser && !internalState.chromePid) return;

  if (internalState.browser) {
    try {
      await internalState.browser.close();
      console.log("[Browser] Playwright connection closed.");
    } catch (err) {
      console.error(
        "[Browser] Error closing Playwright connection:",
        err.message,
      );
    }
  }
  await killBrowserProcess();
}

// Register a beforeExit handler to clean up browser resources on normal exit.
// SIGINT and SIGTERM are intentionally NOT handled here — index.js owns those
// signal handlers and controls whether Chrome is killed on exit. A SIGTERM from
// a new API instance must NOT kill Chrome (the new instance already respawned
// it), so only the main entry point can make that call.
//
// Guard against re-entry: killBrowserProcess() awaits a 1s setTimeout which
// reschedules work and would cause beforeExit to fire again indefinitely.
let _beforeExitRunning = false;
process.on("beforeExit", async () => {
  if (_beforeExitRunning) return;
  _beforeExitRunning = true;
  await cleanupBrowser();
});
