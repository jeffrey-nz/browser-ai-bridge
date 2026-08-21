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

  // T-057: hasCount === "!== undefined" — NaN and out-of-range integers are
  // all `!== undefined`, so they used to pass this function, then fail the
  // truthiness check in main()'s pinned branch (NaN/0 are falsy, 99 is not)
  // and fall through to the same silent random draw T-055 closed for a
  // missing flag, just via a malformed VALUE instead of an absent one.
  test("--count nine (parses to NaN) throws", () => {
    assert.throws(
      () => validateStimulusArgs({ count: Number("nine"), color: "teal" }),
      /--count must be an integer from 3 to 9/,
    );
  });

  test("--count 0 throws", () => {
    assert.throws(
      () => validateStimulusArgs({ count: 0, color: "teal" }),
      /--count must be an integer from 3 to 9/,
    );
  });

  test("--count 99 throws", () => {
    assert.throws(
      () => validateStimulusArgs({ count: 99, color: "teal" }),
      /--count must be an integer from 3 to 9/,
    );
  });

  test("--count 3 (bottom of range): valid", () => {
    assert.doesNotThrow(() =>
      validateStimulusArgs({ count: 3, color: "teal" }),
    );
  });

  test("--count 9 (top of range): valid", () => {
    assert.doesNotThrow(() =>
      validateStimulusArgs({ count: 9, color: "teal" }),
    );
  });

  // T-057 clause 2/3: this check moved here from main()'s pinned branch —
  // it used to only fire once count was already truthy, so a bad count
  // masked a bad colour by reaching the random draw first. Testing it here
  // instead of via main() pins the rule at the same layer as the count
  // checks above it.
  test("--color tael (not in the palette) throws", () => {
    assert.throws(
      () => validateStimulusArgs({ count: 5, color: "tael" }),
      /--color tael is not one of/,
    );
  });
});
