import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import {
  applySpaceHack,
  triggerFallbackSubmit,
} from "./submission/keyboardHacks.js";
import { verifySubmission } from "./submission/verifySubmit.js";

export async function clickOrFallbackToEnter(
  page,
  submitBtnLocator,
  inputBoxLocator,
  stopBtnLocator,
  options = {},
) {
  const {
    retries = 1,
    spaceHack = false,
    ctrlEnterFallback = false,
    shouldAbort,
    postClickWaitMs = 2200,
    verifyWaitMs = 1500,
  } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Check abort condition before wasting time on the click attempt.
    if (shouldAbort) {
      const preErr = await shouldAbort(attempt).catch(() => null);
      if (preErr) throw preErr;
    }

    if (spaceHack) {
      await applySpaceHack(page, inputBoxLocator);
    }

    const isBtnVisible = await submitBtnLocator
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    const isDisabled = await submitBtnLocator
      .evaluate((b) => b.disabled || b.getAttribute("aria-disabled") === "true")
      .catch(() => false);

    const forceKeyboard = ctrlEnterFallback && attempt > 2;
    const isLastAttempt = attempt === retries;

    log(
      colors.dim(
        `  [Send] Attempt ${attempt}/${retries}: visible=${isBtnVisible} disabled=${isDisabled} forceKeyboard=${forceKeyboard}`,
      ),
    );

    try {
      if (isLastAttempt && isBtnVisible) {
        log(
          colors.dim(`  [Send] Trying JS evaluation click (last attempt)...`),
        );
        await submitBtnLocator.evaluate((btn) => btn.click()).catch(() => {});
      } else if (isBtnVisible && !isDisabled && !forceKeyboard) {
        await submitBtnLocator.click({ force: true, delay: 50 });
      } else {
        await triggerFallbackSubmit(
          page,
          inputBoxLocator,
          attempt,
          ctrlEnterFallback,
        );
      }
    } catch (err) {}

    await page.waitForTimeout(postClickWaitMs);

    const isSuccess = await verifySubmission(inputBoxLocator, stopBtnLocator, {
      verifyWaitMs,
    });

    if (isSuccess || retries === 1) {
      return true;
    }

    if (shouldAbort) {
      const abortErr = await shouldAbort(attempt).catch(() => null);
      if (abortErr) throw abortErr;
    }

    log(
      colors.yellow(
        `  [Send] Attempt ${attempt} failed to trigger send. Retrying...`,
      ),
    );
  }

  throw new Error(
    "Failed to submit prompt: input did not clear and generation did not start.",
  );
}
