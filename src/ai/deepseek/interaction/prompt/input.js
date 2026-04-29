import {
  clearAndType,
  clickOrFallbackToEnter,
} from "#ai/shared/domInteraction.js";
import { resolveSelector } from "#ai/shared/locatorEngine.js";
import { DEEPSEEK_LOCATORS } from "../../locators.js";

export async function injectDeepSeekText(page, text) {
  const inputSel = await resolveSelector(page, DEEPSEEK_LOCATORS.inputBox);
  await clearAndType(page, page.locator(inputSel).last(), text, {
    useEvalClear: true,
    triggerEvents: true,
  });
}

export async function clickDeepSeekSend(page) {
  const sendSel = await resolveSelector(page, DEEPSEEK_LOCATORS.sendBtn);
  const inputSel = await resolveSelector(page, DEEPSEEK_LOCATORS.inputBox);
  const stopSel = await resolveSelector(page, DEEPSEEK_LOCATORS.stopBtn);

  await clickOrFallbackToEnter(
    page,
    page.locator(sendSel).last(),
    page.locator(inputSel).last(),
    page.locator(stopSel).last(),
    { retries: 5, ctrlEnterFallback: true },
  );
}
