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
export async function resolveVisibleInOrder(
  page,
  provider,
  key,
  selectors,
  { timeoutMs = 500, logPath } = {},
) {
  const visibleIndexes = [];
  let pickedIndex = -1;
  for (let i = 0; i < selectors.length; i++) {
    const isVisible = await page
      .locator(selectors[i])
      .last()
      .isVisible({ timeout: timeoutMs })
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
