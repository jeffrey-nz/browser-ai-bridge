import { pollUntil } from "#utils/poller.js";

export async function verifySubmission(
  inputBoxLocator,
  stopBtnLocator,
  opts = {},
) {
  const { verifyWaitMs = 1500 } = opts;

  if (!stopBtnLocator) return true;

  try {
    return await pollUntil(
      async () => {
        const isGenerating = await stopBtnLocator
          .isVisible({ timeout: 300 })
          .catch(() => false);

        const remainingText = await inputBoxLocator
          .evaluate((el) => {
            let text = el.textContent || el.value || "";
            text = String(text).replace(/[\u200B-\u200D\uFEFF]/g, "");
            return text.trim();
          })
          .catch(() => "");

        if (isGenerating || remainingText.length === 0) {
          return true;
        }

        return false;
      },
      { timeoutMs: verifyWaitMs, pollIntervalMs: 120 },
    );
  } catch (err) {
    return false;
  }
}
