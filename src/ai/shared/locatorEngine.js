import { logger } from "#utils/logger.js";

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
