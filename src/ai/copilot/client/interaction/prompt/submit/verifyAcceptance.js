import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { checkStopButton, checkTextareaState } from "./acceptance/uiSignals.js";
import {
  checkMessageCount,
  checkMessageText,
} from "./acceptance/domSignals.js";
import { COPILOT_365_LOCATORS } from "../../../locators.js";

// Content policy refusal phrases. Copilot 365 shows these as an inline message
// below the input box when it refuses a prompt — the textarea is NOT cleared and
// no "done" signals fire, so the normal acceptance checks all time out.
const REFUSAL_PHRASES = [
  "it looks like i can't respond to this",
  "let's try a different topic",
  "sorry, it looks like i can",
];

async function checkContentPolicyRefusal(page, pollIndex) {
  try {
    // Use Playwright's text locator to scan the entire visible page for refusal
    // phrases. The refusal message may appear as an inline UI element below the
    // input box (not a proper chat message), so we cannot scope to responseBlock.
    const refusalLocator = page.locator(
      "text=/it looks like i can't respond|let's try a different topic|sorry, it looks like i can/i",
    );
    const visible = await refusalLocator
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (visible) {
      log(
        colors.yellow(
          `  [Accept] Content policy refusal detected — treating as accepted (poll ${pollIndex})`,
        ),
      );
      return true;
    }
  } catch {
    /* non-fatal */
  }
  return false;
}

// Copilot sometimes responds by creating a Pages widget or Designer image
// rather than a chat message. The submission WAS accepted — the widget IS
// the response. Detect this early so we don't exhaust all retries re-injecting
// the same prompt onto a page that already accepted it.
const WIDGET_RESPONSE_SELECTOR = [
  COPILOT_365_LOCATORS.pageWidget,
  COPILOT_365_LOCATORS.designerImageFrame,
].join(", ");

async function checkWidgetResponse(page, pollIndex) {
  const visible = await page
    .locator(WIDGET_RESPONSE_SELECTOR)
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
  if (visible) {
    log(
      colors.dim(
        `  [Accept] Widget response detected — Copilot accepted the prompt and created a widget (poll ${pollIndex})`,
      ),
    );
    return true;
  }
  return false;
}

export async function verifyAcceptance(
  page,
  textArea,
  previousText,
  previousCount = 0,
) {
  for (let i = 0; i < 40; i++) {
    const pollIndex = i + 1;

    if (await checkStopButton(page, pollIndex)) return true;
    if (await checkTextareaState(page, textArea, pollIndex)) return true;
    if (await checkMessageCount(page, previousCount, pollIndex)) return true;
    if (await checkMessageText(page, previousText, pollIndex)) return true;
    if (await checkWidgetResponse(page, pollIndex)) return true;
    if (await checkContentPolicyRefusal(page, pollIndex)) return true;

    await page.waitForTimeout(500);
  }

  log(
    colors.yellow(
      `  [Accept] Timed out after 20s — none of the acceptance signals triggered`,
    ),
  );
  return false;
}
