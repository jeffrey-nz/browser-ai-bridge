import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { dismissGroundingMenus } from "../../sidepane.js";
import { clearAndType } from "#ai/shared/domInteraction.js";

async function readTextareaValue(textArea) {
  return textArea
    .evaluate((el) => (el.value || el.innerText || el.textContent || "").trim())
    .catch(() => "");
}

async function readTextareaHeight(textArea) {
  return textArea
    .evaluate((el) => el.getBoundingClientRect().height)
    .catch(() => 0);
}

export async function injectText(page, textArea, textToSubmit, attempt) {
  const isDisabled = await textArea.isDisabled().catch(() => false);
  if (isDisabled) {
    log(colors.yellow("  (Input box is disabled, waiting...)"));
    await page.waitForTimeout(1500);
    return false;
  }

  const heightBefore = await readTextareaHeight(textArea);

  const useEvalClear = attempt >= 2;

  await clearAndType(page, textArea, textToSubmit, {
    triggerEvents: true,
    useEvalClear,
    chunkSize: 18000,
    verify: true,
    maxVerifyWaitMs: 2500,
  });

  let currentVal = await readTextareaValue(textArea);

  await dismissGroundingMenus(page);
  await page.waitForTimeout(250);

  const heightAfter = await readTextareaHeight(textArea);
  const lexicalUpdated = heightAfter > heightBefore || currentVal.length > 0;

  if (!lexicalUpdated) {
    log(
      colors.yellow(
        `  (Attempt ${attempt}: injection produced no editor state change — height ${heightBefore}->${heightAfter}, value="${currentVal.slice(0, 40)}")`,
      ),
    );
  }

  if (!currentVal && textToSubmit.trim().length > 0) {
    log(
      colors.yellow(
        `  (Attempt ${attempt}: all injection strategies failed — textarea still empty)`,
      ),
    );
    return false;
  }

  return true;
}
