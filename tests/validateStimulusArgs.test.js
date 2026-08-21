import test from "node:test";
import assert from "node:assert/strict";
import { validateStimulusArgs } from "../scripts/vision-probe.mjs";

// T-055: main() used to silently fall through to a RANDOM draw for any
// stimulus-flag combination it didn't specifically recognise — a lone
// --count, a lone --color, or --image with no truth to grade it against.
// The run still succeeded and the report was well-formed; the only trace
// was that truth.count/truth.color weren't what was typed. Pinned here so
// the rule can't quietly regress back to a fallthrough.
test.describe("validateStimulusArgs", () => {
  test("no flags at all: valid (random draw)", () => {
    assert.doesNotThrow(() => validateStimulusArgs({}));
  });

  test("--count and --color together: valid (the pin)", () => {
    assert.doesNotThrow(() =>
      validateStimulusArgs({ count: 9, color: "teal" }),
    );
  });

  test("--image + --count + --color: valid (reuse a file)", () => {
    assert.doesNotThrow(() =>
      validateStimulusArgs({ image: "x.png", count: 9, color: "teal" }),
    );
  });

  test("a lone --count throws", () => {
    assert.throws(() => validateStimulusArgs({ count: 9 }), /--color/);
  });

  test("a lone --color throws", () => {
    assert.throws(() => validateStimulusArgs({ color: "teal" }), /--count/);
  });

  test("--image alone (no count/color) throws", () => {
    assert.throws(
      () => validateStimulusArgs({ image: "x.png" }),
      /--count and --color/,
    );
  });

  test("--image + --count without --color throws", () => {
    assert.throws(() => validateStimulusArgs({ image: "x.png", count: 9 }));
  });
});
