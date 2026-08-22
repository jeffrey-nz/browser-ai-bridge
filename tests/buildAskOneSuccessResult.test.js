import test from "node:test";
import assert from "node:assert/strict";
import { buildAskOneSuccessResult } from "../src/routes/ask/askOne.js";

// T-079: askOne.js destructured imageAttached/imageAttachedCause/
// imageAttachedEvidence out of executeAskTurn's return and copied them onto
// the fan-out result, but never named visionModeVerdict — so an /api/ask-all
// image turn against deepseek produced a row saying imageAttached:true with
// no field distinguishing a confirmed Vision-mode turn from an unrouted one
// that (per T-068) can fabricate a count. buildAskOneSuccessResult is the
// pulled-out shape logic; these pin that visionModeVerdict now travels the
// same gate as imageAttachedEvidence, and — the acceptance's own requirement
// — that a turn with no image carries no visionModeVerdict KEY at all, not
// just an undefined value (JSON.stringify drops undefined values anyway, so
// the meaningful assertion is `in`/hasOwn, not `=== undefined`).
test.describe("buildAskOneSuccessResult", () => {
  test("deepseek image turn with a confirmed Vision mode: visionModeVerdict present", () => {
    const result = buildAskOneSuccessResult("deepseek", {
      response: "SEES=yes COUNT=6 COLOR=teal",
      data: {},
      turnIndex: 1,
      sessionAgeMs: 1000,
      imageAttached: true,
      imageAttachedEvidence: { strategy: "hidden-input" },
      visionModeVerdict: "clicked-and-confirmed-on",
    });
    assert.equal(result.visionModeVerdict, "clicked-and-confirmed-on");
  });

  test("deepseek TEXT turn (no image at all): no visionModeVerdict KEY", () => {
    const result = buildAskOneSuccessResult("deepseek", {
      response: "hello",
      data: {},
      turnIndex: 1,
      sessionAgeMs: 1000,
      imageAttached: undefined,
      imageAttachedCause: undefined,
      imageAttachedEvidence: undefined,
      visionModeVerdict: undefined,
    });
    assert.equal(Object.hasOwn(result, "visionModeVerdict"), false);
  });

  test("non-deepseek provider image turn: no visionModeVerdict KEY", () => {
    const result = buildAskOneSuccessResult("chatgpt", {
      response: "I see 6 teal shapes.",
      data: {},
      turnIndex: 1,
      sessionAgeMs: 1000,
      imageAttached: true,
      imageAttachedEvidence: { strategy: "hidden-input" },
      visionModeVerdict: undefined,
    });
    assert.equal(Object.hasOwn(result, "visionModeVerdict"), false);
    // Confirms this isn't just "the whole optional block got skipped" —
    // imageAttached itself is still present, only visionModeVerdict is absent.
    assert.equal(result.imageAttached, true);
  });

  test("failed upload still carries its visionModeVerdict — not gated to imageAttached===true", () => {
    const result = buildAskOneSuccessResult("deepseek", {
      response: "SEES=no",
      data: {},
      turnIndex: 1,
      sessionAgeMs: 1000,
      imageAttached: false,
      imageAttachedCause: "upload_failed",
      visionModeVerdict: "not-confirmed",
    });
    assert.equal(result.imageAttached, false);
    assert.equal(result.visionModeVerdict, "not-confirmed");
  });

  // T-058 clause 3: imageAttachedEvidence must not be gated behind
  // imageAttached===true — a FALSE row needs evidenceSelectorUsed exactly
  // as much as a TRUE row needs its match details.
  test("failed upload with a populated evidenceOut: imageAttachedEvidence still carried", () => {
    const result = buildAskOneSuccessResult("chatgpt", {
      response: "SEES=no",
      data: {},
      turnIndex: 1,
      sessionAgeMs: 1000,
      imageAttached: false,
      imageAttachedCause: "unconfirmed",
      imageAttachedEvidence: { evidenceSelectorUsed: 'img[src^="blob:"]' },
    });
    assert.equal(result.imageAttached, false);
    assert.deepEqual(result.imageAttachedEvidence, {
      evidenceSelectorUsed: 'img[src^="blob:"]',
    });
  });

  // T-058 clause 2: uploadFileToPage throwing at the fs.access check (the
  // NOT_OFFERED path, before uploadFile.js:116 ever sets a field) leaves
  // evidenceOut as `{}` — an empty object is truthy, so a bare `if
  // (imageAttachedEvidence)` guard would have let it through reading as
  // "evidence was recorded and it was empty" instead of "there is none".
  // This drives that exact not-found path's report shape and asserts the
  // KEY is absent, not just falsy.
  test("NOT_OFFERED path (empty evidenceOut): no imageAttachedEvidence KEY at all", () => {
    const result = buildAskOneSuccessResult("chatgpt", {
      response: "SEES=no",
      data: {},
      turnIndex: 1,
      sessionAgeMs: 1000,
      imageAttached: false,
      imageAttachedCause: "not_offered",
      imageAttachedEvidence: {}, // exactly what uploadFile.js's NOT_OFFERED throw leaves behind
    });
    assert.equal(Object.hasOwn(result, "imageAttachedEvidence"), false);
    // Confirms this isn't the whole optional block being skipped — the
    // cause and warning are still present, only the empty evidence is not.
    assert.equal(result.imageAttached, false);
    assert.equal(result.imageAttachedCause, "not_offered");
  });
});
