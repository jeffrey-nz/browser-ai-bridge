import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { extractLastMessage } from "../../extract/index.js";

export async function checkMessageCount(page, previousCount, pollIndex) {
  const currentCount = await page
    .evaluate(
      () =>
        document.querySelectorAll(
          'div[id^="chatMessageResponse-"], [data-testid="m365-chat-llm-web-ui-chat-message"], [data-content="ai-message"], [data-testid="ai-message"], [data-testid="chat-message-content"], .message-content',
        ).length,
    )
    .catch(() => 0);

  if (currentCount > previousCount) {
    log(
      colors.dim(
        `  [Accept] Message count ${previousCount}→${currentCount} — submission confirmed (poll ${pollIndex})`,
      ),
    );
    return true;
  }
  return false;
}

export async function checkMessageText(page, previousText, pollIndex) {
  const currentText = await extractLastMessage(page, {
    optional: true,
    fast: true,
  }).catch(() => "");

  if (currentText !== previousText && currentText !== "") {
    log(
      colors.dim(
        `  [Accept] Last message changed — submission confirmed (poll ${pollIndex})`,
      ),
    );
    return true;
  }
  return false;
}
