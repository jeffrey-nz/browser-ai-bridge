import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function checkStopButton(page, pollIndex) {
  const stopBtn = page
    .locator(
      'button[aria-label*="Stop" i], button[title*="Stop" i], button[aria-label*="Interrupt" i], button[title*="Interrupt" i], [data-testid="stop-button"]',
    )
    .last();

  if (await stopBtn.isVisible().catch(() => false)) {
    log(
      colors.dim(
        `  [Accept] Stop button visible — submission confirmed (poll ${pollIndex})`,
      ),
    );
    return true;
  }
  return false;
}

export async function checkTextareaState(page, textArea, pollIndex) {
  if (await textArea.isDisabled().catch(() => false)) {
    log(
      colors.dim(
        `  [Accept] Textarea disabled — submission confirmed (poll ${pollIndex})`,
      ),
    );
    return true;
  }

  const textareaVal = await textArea
    .evaluate((el) => (el.value || el.innerText || "").trim())
    .catch(() => null);

  if (textareaVal === "") {
    await page.waitForTimeout(400);
    const textareaVal2 = await textArea
      .evaluate((el) => (el.value || el.innerText || "").trim())
      .catch(() => null);

    if (textareaVal2 === "") {
      log(
        colors.dim(
          `  [Accept] Textarea cleared — submission confirmed (poll ${pollIndex})`,
        ),
      );
      return true;
    }
  }

  return false;
}
