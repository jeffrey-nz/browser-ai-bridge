import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveVisibleInOrder,
  resolveSelector,
} from "../src/ai/shared/locatorEngine.js";
import {
  recordLocatorResolution,
  readLocatorResolutions,
} from "../src/ai/shared/locatorResolutionLog.js";

/**
 * T-108: a comma-joined CSS selector resolves in DOCUMENT order, so
 * `.last()`/`.first()` pick by page position, never by list position — a
 * written priority order is inert under a join. resolveVisibleInOrder is
 * the loop that actually honours the list: first visible entry, IN THE
 * ORDER WRITTEN, wins — independent of where its match happens to sit in
 * the DOM. No real browser needed to pin this: a fake `page.locator()`
 * whose `.last().isVisible()` answers from a fixed visibility set is
 * enough to test the resolution LOGIC; the real-DOM claim (that a joined
 * selector and this loop can disagree on the same page) is pinned
 * separately as a live fixture under evidence/, per this repo's own
 * "integration tests against real browsers are not feasible in CI" stance.
 */
function fakePage(visibleSelectors) {
  return {
    locator(selector) {
      return {
        last() {
          // Carries the selector it was built from so a test can identify
          // WHICH candidate resolveVisibleInOrder actually returned,
          // without needing a real DOM.
          return {
            __selector: selector,
            async isVisible() {
              return visibleSelectors.includes(selector);
            },
          };
        },
      };
    },
  };
}

// Every resolveVisibleInOrder call below passes a tmp logPath so these
// tests neither depend on nor pollute the real
// logs/locator-resolutions.jsonl (a fixed, production-only path).
function tmpLogPath(dir) {
  return join(dir, "resolutions.jsonl");
}

test("resolveVisibleInOrder picks the first LIST entry that is visible, regardless of DOM/array position", async () => {
  const dir = mkdtempSync(join(tmpdir(), "locator-log-test-"));
  try {
    // #b is visible; if this were a joined `.last()` selector over a page
    // where #c also happened to be the DOM-last visible match, THAT would
    // win instead — the whole bug this ticket is about. Here only #b is
    // visible at all, so the fake can't smuggle in a DOM-position answer:
    // the only way to get "#b" back is by having walked the list in order.
    const page = fakePage(["#b"]);
    const picked = await resolveVisibleInOrder(
      page,
      "test",
      "key",
      ["#a", "#b", "#c"],
      {
        logPath: tmpLogPath(dir),
      },
    );
    assert.equal(picked.__selector, "#b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveVisibleInOrder: when two selectors both match, the EARLIER one in the list wins, not the one written last", async () => {
  const dir = mkdtempSync(join(tmpdir(), "locator-log-test-"));
  try {
    const page = fakePage(["#a", "#c"]);
    const picked = await resolveVisibleInOrder(
      page,
      "test",
      "key",
      ["#a", "#b", "#c"],
      {
        logPath: tmpLogPath(dir),
      },
    );
    assert.equal(picked.__selector, "#a");

    // Same visibility, list order reversed — the winner follows the list,
    // not the visibility set's own ordering.
    const pickedReversed = await resolveVisibleInOrder(
      page,
      "test",
      "key",
      ["#c", "#b", "#a"],
      { logPath: tmpLogPath(dir) },
    );
    assert.equal(pickedReversed.__selector, "#c");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveVisibleInOrder returns null when nothing in the list is visible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "locator-log-test-"));
  try {
    const page = fakePage([]);
    const picked = await resolveVisibleInOrder(
      page,
      "test",
      "key",
      ["#a", "#b"],
      {
        logPath: tmpLogPath(dir),
      },
    );
    assert.equal(picked, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recordLocatorResolution / readLocatorResolutions round-trip matchCount, pickedIndex and pickedSelector", () => {
  const dir = mkdtempSync(join(tmpdir(), "locator-log-test-"));
  const logPath = join(dir, "resolutions.jsonl");
  try {
    const entry = recordLocatorResolution(
      {
        provider: "test",
        key: "key",
        matchCount: 2,
        pickedIndex: 1,
        pickedSelector: "#b",
      },
      logPath,
    );
    assert.equal(entry.matchCount, 2);
    assert.equal(entry.pickedIndex, 1);
    assert.equal(entry.pickedSelector, "#b");
    assert.ok(entry.ts);

    // A second entry, appended not overwritten.
    recordLocatorResolution(
      {
        provider: "test",
        key: "key",
        matchCount: 1,
        pickedIndex: 0,
        pickedSelector: "#a",
      },
      logPath,
    );

    const rows = readLocatorResolutions(logPath);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], entry);
    assert.equal(rows[1].pickedSelector, "#a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveVisibleInOrder records the SAME matchCount/pickedIndex it resolves with", async () => {
  const dir = mkdtempSync(join(tmpdir(), "locator-log-test-"));
  const logPath = join(dir, "resolutions.jsonl");
  try {
    const page = fakePage(["#a", "#c"]);
    const picked = await resolveVisibleInOrder(
      page,
      "test",
      "key",
      ["#a", "#b", "#c"],
      {
        logPath,
      },
    );
    assert.equal(picked.__selector, "#a");

    // resolveVisibleInOrder already wrote its own record to logPath as a
    // side effect of the call above — read it back and confirm it matches
    // what actually happened: 2 of the 3 selectors visible (#a and #c),
    // index 0 (#a) picked, exactly what clause 1 asks a reader to be able
    // to answer from this file.
    const rows = readLocatorResolutions(logPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].matchCount, 2);
    assert.equal(rows[0].pickedIndex, 0);
    assert.equal(rows[0].pickedSelector, "#a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recordLocatorResolution never throws when the log path cannot be written", () => {
  // Block the path: a FILE sits where a directory needs to be created —
  // fs.mkdirSync(..., {recursive:true}) fails on this, unlike a merely
  // nonexistent path (which it creates fine).
  const dir = mkdtempSync(join(tmpdir(), "locator-log-test-"));
  const blockerFile = join(dir, "blocker");
  const badPath = join(blockerFile, "sub", "log.jsonl");
  try {
    writeFileSync(blockerFile, "not a directory", "utf8");
    assert.doesNotThrow(() => {
      recordLocatorResolution(
        {
          provider: "p",
          key: "k",
          matchCount: 0,
          pickedIndex: -1,
          pickedSelector: null,
        },
        badPath,
      );
    });
    // And the failed write leaves nothing readable — readLocatorResolutions
    // must also fail closed (empty array), not throw.
    assert.deepEqual(readLocatorResolutions(badPath), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * T-110: resolveSelector(page, selectorChain) looked like the one place in
 * this codebase already walking a candidate list in order — but every
 * deepseek caller passes a pre-joined comma STRING (DEEPSEEK_LOCATORS.*),
 * not an array, so `Array.isArray(selectorChain)` was false and the whole
 * string became a ONE-ELEMENT chain: the loop ran once, checking
 * visibility of the entire comma list as a single Playwright selector —
 * functionally identical to a joined-selector-plus-`.last()` resolution,
 * DOM position deciding, list order inert. These tests pin the fix (a
 * string chain is split into its real candidates before the loop runs)
 * against the same fake-page harness used for resolveVisibleInOrder above.
 */

test("resolveSelector splits a comma-joined string chain and walks it in list order — the first LIST candidate that's visible wins, not the DOM-last one", async () => {
  // Only "#b" is visible. A pre-T-110 resolveSelector would treat the
  // WHOLE string as one candidate and check ITS OWN visibility (false,
  // since the fake only recognises the three individual selectors) —
  // returning the fallback instead of ever finding #b. Getting "#b" back
  // here is only possible if the string was actually split into three
  // real candidates and walked.
  const page = fakePage(["#b"]);
  const picked = await resolveSelector(page, "#a, #b, #c");
  assert.equal(picked, "#b");
});

test("resolveSelector: the earlier candidate in the string wins when two are visible, regardless of which is DOM-last", async () => {
  const page = fakePage(["#a", "#c"]);
  const picked = await resolveSelector(page, "#a, #b, #c");
  assert.equal(picked, "#a");

  const pickedReversed = await resolveSelector(page, "#c, #b, #a");
  assert.equal(pickedReversed, "#c");
});

test("resolveSelector does not split a comma that sits inside a functional pseudo-class", async () => {
  // `:has(a, b)` is ONE selector; its inner comma is not a candidate
  // separator. A naive `.split(",")` would break it into ":has(a" and
  // "b)", neither a valid selector, and neither would ever be recognised
  // as visible by anything. Only #wrap is visible, and it is only
  // reachable under the literal, un-split selector string.
  const page = fakePage(["div:has(span, em)", "#other"]);
  const picked = await resolveSelector(page, "div:has(span, em), #other");
  assert.equal(picked, "div:has(span, em)");
});

test("resolveSelector still accepts an array chain, unchanged", async () => {
  const page = fakePage(["#b"]);
  const picked = await resolveSelector(page, ["#a", "#b", "#c"]);
  assert.equal(picked, "#b");
});

test("resolveSelector's fallback (nothing visible) is unchanged: the whole original string for a string chain, the first element for an array chain", async () => {
  const page = fakePage([]);
  const pickedFromString = await resolveSelector(page, "#a, #b, #c");
  assert.equal(pickedFromString, "#a, #b, #c");

  const pickedFromArray = await resolveSelector(page, ["#a", "#b", "#c"]);
  assert.equal(pickedFromArray, "#a");
});
