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
});
