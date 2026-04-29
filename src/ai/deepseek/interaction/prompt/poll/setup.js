import { logger } from "#utils/logger.js";
import { resolveSelector } from "#ai/shared/locatorEngine.js";
import { calculateDomFingerprint } from "#ai/shared/domFingerprint.js";
import { DEEPSEEK_LOCATORS } from "../../../locators.js";

const KNOWN_HEALTHY_FINGERPRINTS = [];

export async function runPreflightChecks(page) {
  const currentFingerprint = await calculateDomFingerprint(page);
  logger.debug(
    `[DeepSeek Poll] Current DOM Fingerprint: ${currentFingerprint}`,
  );

  if (
    currentFingerprint &&
    KNOWN_HEALTHY_FINGERPRINTS.length > 0 &&
    !KNOWN_HEALTHY_FINGERPRINTS.includes(currentFingerprint)
  ) {
    logger.error(
      `[DeepSeek Poll] MAJOR UI CHANGE DETECTED! Fingerprint ${currentFingerprint} unknown. Aborting to prevent erratic clicks.`,
    );
    throw new Error("UI_FINGERPRINT_MISMATCH");
  }

  const stopBtnSel = await resolveSelector(page, DEEPSEEK_LOCATORS.stopBtn);
  const responseBlockSel = await resolveSelector(
    page,
    DEEPSEEK_LOCATORS.responseBlock,
  );
  const cfOverlaySel = await resolveSelector(
    page,
    DEEPSEEK_LOCATORS.cloudflareOverlay,
  );

  return { stopBtnSel, responseBlockSel, cfOverlaySel };
}
