import { tryFallbacks } from "./locator/fallbacks.js";
import { promptForSelector } from "./locator/interactive.js";

export async function ensureLocator(
  page,
  key,
  description,
  defaultLocatorFn,
  options = {},
) {
  const { requireVisible = true, optional = false } = options;

  while (true) {
    // T-108 clause 2: a null defaultLocatorFn means this key has no
    // separate "priority" list of its own — FALLBACK_SELECTORS[key],
    // walked in order by tryFallbacks, IS the resolution, not a second
    // tier only consulted when a joined-and-`.last()`'d guess misses.
    if (defaultLocatorFn) {
      const defLoc = defaultLocatorFn();
      if (
        !requireVisible ||
        (await defLoc.isVisible({ timeout: 1500 }).catch(() => false))
      ) {
        return defLoc;
      }
    }

    const fallbackLoc = await tryFallbacks(page, key);
    if (fallbackLoc) {
      return fallbackLoc;
    }

    if (optional) {
      return null;
    }

    const result = await promptForSelector(
      page,
      key,
      description,
      requireVisible,
    );

    if (result === "RETRY") {
      continue;
    }

    return result;
  }
}
