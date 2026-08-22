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
// `visible` controls isVisible()/waitFor() outcomes, `clickThrows` lets a
// test drive a throw INSIDE the menuVisible branch, before the branch's
// own later UNCONFIRMED throw is ever reached.
function makeLocator({ visible = true, clickThrows = false } = {}) {
  const loc = {
    first: () => loc,
    // T-108: the upload-menu button resolution now goes through
    // resolveVisibleInOrder, which calls `.last()` on each individual
    // selector (mirroring copilot's existing tryFallbacks) rather than
    // `.first()` on the whole joined list — the fake needs the same
    // method the real Locator interface offers.
    last: () => loc,
    isVisible: async () => visible,
    click: async () => {
      if (clickThrows) throw new Error("mock: click intercepted");
    },
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

// T-093 review round 2: the fix above (evidenceOut set immediately before
// waitForAttachmentEvidence) only survives the branch's OWN final
// UNCONFIRMED throw — four EARLIER throw points in the same branch
// (menuBtn.click, uploadItem.waitFor, page.waitForEvent, fileChooser.
// setFiles) reached gemini/index.js's catch with evidenceOut still {}.
// This drives one of them (menuBtn.click, the very first thing the
// menuVisible branch does) and asserts evidenceSelectorUsed survives THAT
// throw too — the fix that closes it is hoisting the assignment to the
// top of the branch, not just above the later call.
test("uploadFileToGemini submenu branch: evidenceSelectorUsed survives an EARLY throw (menuBtn.click), not only the final UNCONFIRMED one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gemini-upload-test-"));
  const filePath = join(dir, "fixture.png");
  writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const page = {
      locator: (selector) => {
        if (/Upload & tools|upload file menu/i.test(selector)) {
          // Visible (so the menuVisible branch is entered at all), but
          // its click throws — the first thing that branch does.
          return makeLocator({ visible: true, clickThrows: true });
        }
        return makeLocator({ visible: true });
      },
      waitForEvent: async () => ({ setFiles: async () => {} }),
      waitForTimeout: async () => {},
    };
    const evidenceOut = {};
    await assert.rejects(() => uploadFileToGemini(page, filePath, evidenceOut));
    assert.equal(evidenceOut.evidenceSelectorUsed, GEMINI_ATTACHMENT_EVIDENCE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
