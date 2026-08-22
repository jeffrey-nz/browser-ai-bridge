import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uploadFileToGemini,
  GEMINI_ATTACHMENT_EVIDENCE,
} from "../src/ai/gemini/interaction/prompt/input.js";
import { UploadOutcomeError } from "../src/ai/shared/uploadOutcome.js";

// T-093: uploadFileToGemini's submenu branch (the NORMAL path — reached
// whenever the upload-menu button is found) recorded strategy/
// requireGrowth/grew on SUCCESS only. Its own UNCONFIRMED throw (the
// chooser accepted the file but no thumbnail ever appeared) recorded
// nothing at all, even though T-058 added a comment at this file's caller
// claiming evidenceSelectorUsed "is set before anything can throw" — false
// for exactly this branch. This drives that branch to its failure throw
// with a minimal fake `page` and asserts evidenceSelectorUsed survives.

// A locator stub whose every method is independently configurable —
// `visible` controls isVisible()/waitFor() outcomes.
function makeLocator({ visible = true } = {}) {
  const loc = {
    first: () => loc,
    isVisible: async () => visible,
    click: async () => {},
    waitFor: async ({ state } = {}) => {
      if (!visible) throw new Error(`mock: not ${state ?? "visible"}`);
    },
    scrollIntoViewIfNeeded: async () => {},
  };
  return loc;
}

// The menu button and the "Upload from computer"/"Files" menu item must
// both resolve normally so the flow reaches the file chooser — only the
// EVIDENCE selector (GEMINI_ATTACHMENT_EVIDENCE, checked by
// waitForAttachmentEvidence inside uploadFileToGemini) needs to fail, to
// drive this test's target branch (chooser accepted the file, no
// thumbnail ever appeared) rather than some earlier one.
function makeMockPage() {
  return {
    locator: (selector) => {
      if (/Upload & tools|upload file menu/i.test(selector)) {
        return makeLocator({ visible: true });
      }
      if (/Upload from computer|Files/i.test(selector)) {
        return makeLocator({ visible: true });
      }
      // Anything else reaching page.locator() at this point is the
      // evidence selector, checked inside waitForAttachmentEvidence —
      // made to fail on purpose, to reach the UNCONFIRMED throw.
      return makeLocator({ visible: false });
    },
    waitForEvent: async () => ({ setFiles: async () => {} }),
    waitForTimeout: async () => {},
  };
}

test("uploadFileToGemini submenu branch: evidenceSelectorUsed survives onto the UNCONFIRMED throw", async () => {
  // uploadFileToGemini's own T-038 file-existence check (mirroring
  // uploadFile.js's) throws NOT_OFFERED before any menu logic runs at all
  // if the path doesn't exist — a REAL file is needed to reach the
  // submenu branch this test targets, not a placeholder path.
  const dir = mkdtempSync(join(tmpdir(), "gemini-upload-test-"));
  const filePath = join(dir, "fixture.png");
  writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const evidenceOut = {};
    await assert.rejects(
      () => uploadFileToGemini(makeMockPage(), filePath, evidenceOut),
      UploadOutcomeError,
    );
    assert.equal(evidenceOut.evidenceSelectorUsed, GEMINI_ATTACHMENT_EVIDENCE);
    // The success-only fields must NOT appear — this is the failure branch.
    assert.equal("strategy" in evidenceOut, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
