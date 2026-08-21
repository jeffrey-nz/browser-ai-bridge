import test from "node:test";
import assert from "node:assert/strict";
import { selectDeepSeekVisionMode } from "../src/ai/deepseek/interaction/mode.js";

// T-073: selectDeepSeekVisionMode used to return undefined whether it
// worked or not, so a stale radio (T-018's chatgpt shape) or a click that
// silently failed to land were indistinguishable from a genuine success —
// and T-068 showed the cost of that: an unrouted deepseek image turn can
// come back with a fabricated COUNT, not a safe "SEES=no". This pins the
// three verdicts against a stubbed page, covering BOTH silent-failure
// paths separately (clause 5's own requirement): the radio never becoming
// visible, and the click resolving but aria-checked staying false.

function makeLocatorObj({ waitForOk, ariaCheckedSequence, clickSpy }) {
  let callIndex = 0;
  const locatorObj = {
    async waitFor() {
      if (!waitForOk) {
        throw new Error("locator never became visible");
      }
    },
    async getAttribute(name) {
      assert.equal(name, "aria-checked");
      const value =
        ariaCheckedSequence[
          Math.min(callIndex, ariaCheckedSequence.length - 1)
        ];
      callIndex++;
      return value;
    },
    async click() {
      clickSpy.called = true;
    },
    first() {
      return locatorObj;
    },
  };
  return locatorObj;
}

function makePage({
  waitForOk = true,
  ariaCheckedSequence = ["false"],
  clickSpy = {},
}) {
  const locatorObj = makeLocatorObj({
    waitForOk,
    ariaCheckedSequence,
    clickSpy,
  });
  return {
    locator: () => locatorObj,
  };
}

test.describe("selectDeepSeekVisionMode", () => {
  test("already on: no click, verdict already-on", async () => {
    const clickSpy = {};
    const page = makePage({ ariaCheckedSequence: ["true"], clickSpy });
    const result = await selectDeepSeekVisionMode(page);
    assert.deepEqual(result, { verdict: "already-on" });
    assert.equal(clickSpy.called, undefined);
  });

  test("clicked and confirmed: aria-checked true after the click", async () => {
    const clickSpy = {};
    // First read (before click): false. Second read (after click): true.
    const page = makePage({
      ariaCheckedSequence: ["false", "true"],
      clickSpy,
    });
    const result = await selectDeepSeekVisionMode(page);
    assert.deepEqual(result, { verdict: "clicked-and-confirmed-on" });
    assert.equal(clickSpy.called, true);
  });

  // Silent path (a): the radio never becomes visible at all.
  test("radio never visible: verdict not-confirmed", async () => {
    const page = makePage({ waitForOk: false });
    const result = await selectDeepSeekVisionMode(page);
    assert.deepEqual(result, { verdict: "not-confirmed" });
  });

  // Silent path (b) — the one the pre-T-073 code could not detect at all:
  // the click resolves without throwing, but aria-checked is STILL "false"
  // afterwards (wrong element, an overlay swallowing the click, etc.).
  test("click resolves but aria-checked stays false: verdict not-confirmed", async () => {
    const clickSpy = {};
    const page = makePage({
      ariaCheckedSequence: ["false", "false"],
      clickSpy,
    });
    const result = await selectDeepSeekVisionMode(page);
    assert.deepEqual(result, { verdict: "not-confirmed" });
    assert.equal(clickSpy.called, true);
  });
});
