import { logger } from "#utils/logger.js";
import { recordLocatorResolution } from "./locatorResolutionLog.js";

// T-108 clause 2/3: the one place a list of selectors is resolved by
// WALKING it in the order written — the first visible match wins — rather
// than joining it into one CSS selector and letting `.last()`/`.first()`
// pick by DOCUMENT position instead. Every call records its own
// resolution (clause 1): how many of the list's selectors had a visible
// match, and which index won. `.last()` per individual selector (not the
// whole list) mirrors copilot's existing tryFallbacks — a single selector
// can itself still match more than one element (e.g. a repeated
// `div[contenteditable="true"]`), and taking the DOM-last of THAT one
// selector's own matches is a narrower, already-reviewed idiom, distinct
// from the cross-selector priority order this function exists to honour.
//
// T-108 review: no `timeoutMs` parameter — Locator.isVisible()'s own
// `timeout` option is marked `@deprecated This option is ignored` in
// playwright-core's own types (node_modules/playwright-core/types/
// types.d.ts:14193-14198 — "does not wait for the element to become
// visible and returns immediately"), confirmed empirically too (a
// 6-selector, all-absent resolution completed in 46ms regardless of the
// value passed). A parameter that cannot do what its name promises is
// worse than no parameter: a caller sizing a poll budget around it would
// be sizing around fiction. Callers that need retries poll by calling this
// function again (gemini's upload-menu resolution already does, in its
// own 3-attempt loop) rather than by waiting inside one call.
export async function resolveVisibleInOrder(
  page,
  provider,
  key,
  selectors,
  { logPath } = {},
) {
  const visibleIndexes = [];
  let pickedIndex = -1;
  for (let i = 0; i < selectors.length; i++) {
    const isVisible = await page
      .locator(selectors[i])
      .last()
      .isVisible()
      .catch(() => false);
    if (isVisible) {
      visibleIndexes.push(i);
      if (pickedIndex === -1) pickedIndex = i;
    }
  }

  const resolution = {
    provider,
    key,
    matchCount: visibleIndexes.length,
    pickedIndex,
    pickedSelector: pickedIndex === -1 ? null : selectors[pickedIndex],
  };
  if (logPath) {
    recordLocatorResolution(resolution, logPath);
  } else {
    recordLocatorResolution(resolution);
  }

  return pickedIndex === -1
    ? null
    : page.locator(selectors[pickedIndex]).last();
}

export async function resolveSelector(page, selectorChain, timeoutMs = 1000) {
  const chain = Array.isArray(selectorChain) ? selectorChain : [selectorChain];

  for (const selector of chain) {
    if (!selector) continue;

    try {
      const isVisible = await page
        .locator(selector)
        .last()
        .isVisible({ timeout: timeoutMs })
        .catch(() => false);
      if (isVisible) {
        logger.trace(`[LocatorEngine] Resolved visible selector: ${selector}`);
        return selector;
      }
    } catch (e) {}
  }

  logger.trace(
    `[LocatorEngine] No visible selectors found. Falling back to primary: ${chain[0]}`,
  );
  return chain[0];
}
