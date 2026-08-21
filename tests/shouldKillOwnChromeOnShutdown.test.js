import test from "node:test";
import assert from "node:assert/strict";
import { shouldKillOwnChromeOnShutdown } from "../src/browser/launcher/killer.js";

// T-075: on clean shutdown, killBrowserProcess() used to be called
// unconditionally regardless of whether THIS process ever spawned a
// Chrome — chromePid stays null when connectOverCDP() succeeded on the
// first try (a bridge sharing another's Chrome via CDP_URL), and
// killBrowserProcess()'s untracked-PID fallback then kills whatever owns
// CDP_PORT: someone else's Chrome, on the way out. This pins the pure
// decision extracted to fix it.
test.describe("shouldKillOwnChromeOnShutdown", () => {
  test("chromePid set (this process spawned its own Chrome): kill", () => {
    assert.equal(shouldKillOwnChromeOnShutdown(54321), true);
  });

  test("chromePid null (reused an existing Chrome via CDP_URL): do not kill", () => {
    assert.equal(shouldKillOwnChromeOnShutdown(null), false);
  });
});
