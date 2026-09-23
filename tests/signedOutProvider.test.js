import { test } from "node:test";
import assert from "node:assert/strict";
import { runPromptWorkflow } from "../src/ai/shared/promptWorkflow.js";
// 2026-09-22: the detector moved to blockedPage.js when it grew a third case
// (a timed suspension) alongside the sign-in wall it started as.
import { looksSignedOut } from "../src/ai/shared/blockedPage.js";

/**
 * 2026-09-22: login is verified once, at startup (startup/authSequence.js), and
 * never again. A provider that signs itself out mid-run was therefore invisible:
 * its composer never renders, the input locator times out, and the error lands in
 * `_injectAndSendWithRecovery`'s "recoverable" branch — which reloads the page and
 * retries, the one remedy guaranteed not to work on a sign-in wall.
 *
 * Measured on a long generation run: DeepSeek signed out and the turn spent
 * 5 attempts × (15s locator timeout + 120s backoff) — about eleven minutes — before
 * the chain moved on, then met the same wall on the next turn.
 *
 * Detection must be conservative in one direction and reliable in the other: a
 * false positive discards a working provider, so it requires BOTH a sign-in
 * affordance AND no composer.
 */

function fakePage(visibleSelectorTest, bodyText = "") {
  return {
    locator(sel) {
      return {
        first: () => ({
          isVisible: async () => visibleSelectorTest(sel),
        }),
        last: () => ({ isVisible: async () => visibleSelectorTest(sel) }),
      };
    },
    // diagnoseBlockedPage reads the page text to tell a timed suspension from a
    // sign-in wall; a fake without this looks like a browser that cannot answer.
    evaluate: async () => bodyText,
    isClosed: () => false,
  };
}

const signedOutPage = () =>
  fakePage((sel) => sel.includes("password") || sel.includes("Log in"));
const signedInPage = () =>
  fakePage((sel) => sel.includes("textarea") || sel.includes("contenteditable"));
// The trap case: a signed-IN page that happens to show a "Sign in" link
// somewhere (a marketing banner, a second account prompt) AND has a composer.
const signedInWithSignInLink = () => fakePage(() => true);

test("a page with a sign-in control and NO composer is signed out", async () => {
  assert.equal(await looksSignedOut(signedOutPage()), true);
});

test("a page with a composer is NOT signed out", async () => {
  assert.equal(await looksSignedOut(signedInPage()), false);
});

test("a page with BOTH a sign-in control and a composer is NOT signed out — the false-positive guard", async () => {
  assert.equal(await looksSignedOut(signedInWithSignInLink()), false);
});

test("a composer timeout on a signed-out page returns signedOut, not an endless reload-retry", async () => {
  const page = signedOutPage();
  let injectCalls = 0;
  const result = await runPromptWorkflow(page, "hello", "label", {
    providerName: "DeepSeek",
    injectText: async () => {
      injectCalls += 1;
      // The real shape of the failure: Playwright's locator timeout.
      throw new Error(
        'locator.waitFor: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator(\'textarea[placeholder*="Message DeepSeek" i]\')',
      );
    },
    clickSend: async () => {},
    waitForCompletion: async () => true,
    extractResponse: async () => "",
  });
  assert.equal(result.ok, false);
  assert.equal(result.signedOut, true, "must carry the real diagnosis");
  assert.equal(
    result.rateLimited,
    true,
    "must also set rateLimited so the executor's existing skip-provider path applies",
  );
  assert.match(result.reason, /SIGNED OUT/);
  assert.equal(
    injectCalls,
    1,
    "must NOT reload and retry — that is what wasted eleven minutes",
  );
});

test("the same timeout on a signed-IN page still takes the ordinary recovery path", async () => {
  // Not signed out, so the sign-in branch must not fire. The page has no reload
  // in this fake, so the recovery attempt throws — the point is only that the
  // result is not a signedOut verdict.
  const page = signedInPage();
  await assert.rejects(
    () =>
      runPromptWorkflow(page, "hello", "label", {
        providerName: "DeepSeek",
        injectText: async () => {
          throw new Error("locator.waitFor: Timeout 15000ms exceeded.");
        },
        clickSend: async () => {},
        waitForCompletion: async () => true,
        extractResponse: async () => "",
      }),
    (e) => e.signedOut !== true,
  );
});
