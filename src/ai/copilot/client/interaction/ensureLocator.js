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
    const defLoc = defaultLocatorFn();
    if (
      !requireVisible ||
      (await defLoc.isVisible({ timeout: 1500 }).catch(() => false))
    ) {
      return defLoc;
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
