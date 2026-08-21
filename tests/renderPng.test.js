import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderPng,
  MIN_COUNT,
  COUNT_RANGE,
  SQUARE,
  COLORS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "../scripts/vision-probe.mjs";
import {
  decodePng,
  findComponents,
  isSolidSquare,
} from "../scripts/pngPixels.mjs";

/**
 * T-026: renderPng silently clipped its own largest declared count. count=9
 * needs 960px in a hardcoded 900px canvas — 60px of overflow drawn anyway,
 * turning the first and last square into 50x80 bars. 6 of 6 recorded
 * count=9 fixtures were malformed this way (scripts/fixture-audit.mjs).
 *
 * Reads the generator's own declared range — MIN_COUNT..MIN_COUNT+COUNT_RANGE-1
 * — rather than a typed 3..9, for the same reason the rest of this file's
 * constants are derived and not typed: a range that grows without this test
 * growing with it is exactly how the bug happened the first time.
 */
const rgb = COLORS.teal;

test(`renderPng draws every count in its declared range (${MIN_COUNT}..${MIN_COUNT + COUNT_RANGE - 1}) as exactly that many full ${SQUARE}x${SQUARE} squares`, () => {
  for (let count = MIN_COUNT; count < MIN_COUNT + COUNT_RANGE; count++) {
    const png = renderPng(CANVAS_WIDTH, CANVAS_HEIGHT, count, rgb);
    const decoded = decodePng(png);
    const components = findComponents(decoded, rgb);
    const squares = components.filter((c) => isSolidSquare(c, SQUARE));
    assert.equal(
      components.length,
      count,
      `count=${count}: expected ${count} connected component(s), decoded ${components.length}`,
    );
    assert.equal(
      squares.length,
      count,
      `count=${count}: expected all ${count} component(s) to be exactly ${SQUARE}x${SQUARE} squares, only ${squares.length} were`,
    );
  }
});

test("renderPng refuses to draw a layout that overflows the canvas, instead of clipping it", () => {
  // The exact shape of the original bug: MIN_COUNT+COUNT_RANGE-1 (9) squares
  // do not fit a 900px canvas (960px needed).
  assert.throws(
    () => renderPng(900, CANVAS_HEIGHT, MIN_COUNT + COUNT_RANGE - 1, rgb),
    /overflows the 900px canvas by 60px/,
  );
});
