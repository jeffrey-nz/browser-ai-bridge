import test from "node:test";
import assert from "node:assert/strict";
import { attachFileToCopilot } from "../src/ai/copilot/client/interaction/prompt/send/sendAsFile.js";
import { UploadOutcomeError } from "../src/ai/shared/uploadOutcome.js";

// T-093: attachFileToCopilot never calls uploadFile.js's shared
// uploadFileToPage — it has no verifySelector to name at all. Before this
// fix, its own UNCONFIRMED throw (both the plus-menu and hidden-input
// strategies tried and failed) recorded nothing in evidenceOut, so a
// FALSE copilot row carried no imageAttachedEvidence field once T-058's
// has-keys guard landed — the ungating at this site was a no-op. This
// drives that exact both-strategies-fail path and asserts evidenceOut has
// keys after the throw, naming what was actually tried.

// A locator whose every method fails — both uploadViaPlusMenu and
// uploadViaHiddenInput wrap their own Playwright calls in try/catch and
// return false on ANY thrown error, so making every method reject is
// enough to drive both strategies to their failure return without needing
// per-selector behaviour the way gemini's test does.
function makeFailingPage() {
  const loc = {
    first: () => loc,
    click: async () => {
      throw new Error("mock: element not found");
    },
    waitFor: async () => {
      throw new Error("mock: element not found");
    },
    isVisible: async () => false,
    setInputFiles: async () => {
      throw new Error("mock: element not found");
    },
  };
  return {
    locator: () => loc,
    waitForEvent: async () => {
      throw new Error("mock: no filechooser event");
    },
    waitForTimeout: async () => {},
  };
}

test("attachFileToCopilot: both strategies failing records strategiesAttempted and confirmed:false before throwing", async () => {
  const evidenceOut = {};
  await assert.rejects(
    () =>
      attachFileToCopilot(
        makeFailingPage(),
        "/nonexistent/T-093-mock-path.png",
        evidenceOut,
      ),
    UploadOutcomeError,
  );
  assert.deepEqual(evidenceOut.strategiesAttempted, [
    "plus_menu",
    "hidden_input",
  ]);
  assert.equal(evidenceOut.confirmed, false);
  // No shared verifySelector exists for copilot — this must not invent one.
  assert.equal("evidenceSelectorUsed" in evidenceOut, false);
  // The success-only field must not appear either.
  assert.equal("strategy" in evidenceOut, false);
});
