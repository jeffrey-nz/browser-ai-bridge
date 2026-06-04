import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { createSpinner } from "#app/ui/spinner.js";
import { injectGeminiText, clickGeminiSend } from "./input.js";
import { waitForGeminiCompletion } from "./poll/index.js";
import { extractGeminiResponse } from "./extract.js";

async function handlePostPoll(page, spinner, pollResult) {
  if (pollResult === "ERROR_13") {
    spinner.stop();
    const err = new Error("GEMINI_SNACKBAR_ERROR_13");
    err.isUiError = true;
    throw err;
  } else if (
    pollResult === "TIMEOUT" ||
    pollResult === "ERROR" ||
    pollResult === false
  ) {
    spinner.stop();
    throw new Error(`Gemini polling failed or timed out: ${pollResult}`);
  }

  await page.waitForTimeout(1000);
  spinner.succeed(`Response received.`);

  let responseText = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    responseText = await extractGeminiResponse(page);
    if (responseText) break;
    if (attempt < 3) {
      log(
        colors.dim(
          `  Extraction attempt ${attempt} returned empty, retrying in 2s...`,
        ),
      );
      await page.waitForTimeout(2000);
    }
  }

  if (responseText === "[GEMINI_UI_ERROR] ERROR_13_COOLDOWN") {
    spinner.stop();
    const err = new Error("GEMINI_SNACKBAR_ERROR_13");
    err.isUiError = true;
    throw err;
  }

  if (!responseText) {
    throw new Error("Extracted response text is empty.");
  }

  return { text: responseText };
}

export async function executePromptTurn(page, text, label, sessionId = null) {
  const messageCount = await page.evaluate(
    () => document.querySelectorAll("message-content, model-response").length,
  );

  log(`\n🚀 Injecting ${colors.bold(label)}...`);

  await injectGeminiText(page, text);
  await clickGeminiSend(page);

  const spinner = createSpinner(`Gemini is thinking...`).start();

  try {
    const pollResult = await waitForGeminiCompletion(
      page,
      spinner,
      messageCount,
      sessionId,
    );
    return await handlePostPoll(page, spinner, pollResult);
  } catch (err) {
    err.spinner = spinner;
    throw err;
  }
}

export async function resumePolling(page, sessionId = null) {
  const spinner = createSpinner(`Gemini is thinking... (Resumed)`).start();

  try {
    const pollResult = await waitForGeminiCompletion(page, spinner, 0, sessionId);
    return await handlePostPoll(page, spinner, pollResult);
  } catch (err) {
    err.spinner = spinner;
    throw err;
  }
}
