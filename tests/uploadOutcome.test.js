import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFileToPage } from "../src/ai/shared/uploadFile.js";
import {
  UPLOAD_CAUSES,
  UploadOutcomeError,
  classifyUploadError,
  describeUploadFailure,
} from "../src/ai/shared/uploadOutcome.js";

/**
 * T-038: uploadFileToPage used to collapse three distinct outcomes (nothing
 * ever accepted the file / something accepted it but evidence never
 * appeared / success) into one boolean, with the discriminator only ever
 * reaching a logger with no destination. It now throws UploadOutcomeError
 * with a cause instead — pinned here against a scripted page implementing
 * only the Playwright surface uploadFileToPage touches (no browser).
 */

const dir = mkdtempSync(join(tmpdir(), "upload-outcome-test-"));
const filePath = join(dir, "probe.png");
writeFileSync(filePath, "not a real image; only its existence is read");

function makePage(w) {
  const isFileInput = (s) => /input\[type="file"\]/.test(s);
  const isEvidence = (s) =>
    !isFileInput(s) && /blob:|attachment|thumbnail/i.test(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const handle = (sel) => ({
    async setInputFiles() {
      if (!isFileInput(sel) || w.fileInputs === 0)
        throw new Error("no such element");
    },
    async waitFor({ timeout }) {
      if (isEvidence(sel) && w.evidenceAppears) return;
      await wait(Math.min(timeout, 20));
      throw new Error(`Timeout ${timeout}ms exceeded waiting for ${sel}`);
    },
    async isVisible() {
      return isFileInput(sel) ? w.fileInputs > 0 : !!w.attachButton;
    },
    async click() {},
  });
  return {
    locator(sel) {
      return {
        async count() {
          if (isFileInput(sel)) return w.fileInputs;
          if (isEvidence(sel)) return w.evidenceAppears ? 1 : 0;
          return w.attachButton ? 1 : 0;
        },
        first: () => handle(sel),
        ...handle(sel),
      };
    },
    async waitForTimeout(ms) {
      await wait(Math.min(ms, 10));
    },
    async waitForEvent(name, { timeout }) {
      if (name === "filechooser" && w.chooserBehindButton) {
        return { setFiles: async () => {} };
      }
      await wait(Math.min(timeout, 20));
      throw new Error(`Timeout ${timeout}ms exceeded waiting for "${name}"`);
    },
  };
}

const opts = { timeoutMs: 200, verifyTimeoutMs: 200 };

test("empty page: NOT_OFFERED, and the message doesn't claim an input was found", async () => {
  const page = makePage({
    fileInputs: 0,
    attachButton: false,
    chooserBehindButton: false,
    evidenceAppears: false,
  });
  await assert.rejects(
    () => uploadFileToPage(page, filePath, opts),
    (err) => {
      assert.ok(err instanceof UploadOutcomeError);
      assert.equal(err.code, UPLOAD_CAUSES.NOT_OFFERED);
      return true;
    },
  );
});

test("input present and file set, no confirming evidence, no button: UNCONFIRMED — not NOT_OFFERED, and the message stops saying 'no file input'", async () => {
  const page = makePage({
    fileInputs: 1,
    attachButton: false,
    chooserBehindButton: false,
    evidenceAppears: false,
  });
  await assert.rejects(
    () => uploadFileToPage(page, filePath, opts),
    (err) => {
      assert.ok(err instanceof UploadOutcomeError);
      assert.equal(err.code, UPLOAD_CAUSES.UNCONFIRMED);
      assert.ok(
        !/no file input/i.test(err.message),
        `message must not claim no input was found when one was: ${err.message}`,
      );
      return true;
    },
  );
});

test("input present, evidence appears: succeeds (positive control)", async () => {
  const page = makePage({
    fileInputs: 1,
    attachButton: false,
    chooserBehindButton: false,
    evidenceAppears: true,
  });
  assert.equal(await uploadFileToPage(page, filePath, opts), true);
});

test("chooser behind a button accepts the file, no confirming evidence: UNCONFIRMED", async () => {
  const page = makePage({
    fileInputs: 0,
    attachButton: true,
    chooserBehindButton: true,
    evidenceAppears: false,
  });
  await assert.rejects(
    () => uploadFileToPage(page, filePath, opts),
    (err) => {
      assert.ok(err instanceof UploadOutcomeError);
      assert.equal(err.code, UPLOAD_CAUSES.UNCONFIRMED);
      return true;
    },
  );
});

test("classifyUploadError reads .code off UploadOutcomeError, and defaults everything else to upload_error", () => {
  assert.equal(
    classifyUploadError(new UploadOutcomeError("x", UPLOAD_CAUSES.NOT_OFFERED)),
    UPLOAD_CAUSES.NOT_OFFERED,
  );
  assert.equal(
    classifyUploadError(new Error("some unrelated Playwright failure")),
    UPLOAD_CAUSES.UPLOAD_ERROR,
  );
});

test("describeUploadFailure never claims a composer was involved for the two causes where nothing was offered", () => {
  const noPath = describeUploadFailure(UPLOAD_CAUSES.NO_UPLOAD_PATH);
  const retry = describeUploadFailure(UPLOAD_CAUSES.TEXT_ONLY_RETRY);
  const unconfirmed = describeUploadFailure(UPLOAD_CAUSES.UNCONFIRMED);
  assert.notEqual(noPath, unconfirmed);
  assert.notEqual(retry, unconfirmed);
  assert.notEqual(noPath, retry);
  assert.ok(!/composer/i.test(noPath));
  assert.ok(!/composer/i.test(retry));
  assert.ok(/composer/i.test(unconfirmed));
});
