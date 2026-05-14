import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import {
  injectDeepSeekText,
  clickDeepSeekSend,
  uploadFileToDeepSeek,
} from "./input.js";
import { waitForDeepSeekCompletion } from "./poll/index.js";
import { extractDeepSeekResponse } from "./extract.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { resolveSelector } from "#ai/shared/locatorEngine.js";
import { DEEPSEEK_LOCATORS } from "../../locators.js";
import { logger } from "#utils/logger.js";

export async function sendPromptWithFile(
  page,
  filePath,
  text,
  label = "Visual QA",
  sessionId = null,
) {
  logger.info(`[DeepSeek] Uploading file for visual analysis: ${filePath}`);
  try {
    await uploadFileToDeepSeek(page, filePath);
  } catch (err) {
    logger.warn(
      `[DeepSeek] File upload failed: ${err.message} — sending text-only`,
    );
  }
  return sendPromptAndWait(page, text, label, sessionId);
}

export async function sendPromptAndWait(
  page,
  text,
  label = "Prompt",
  sessionId = null,
) {
  const responseSel = await resolveSelector(
    page,
    DEEPSEEK_LOCATORS.responseBlock,
  );
  // Broad selector (used by the poll loop to detect any new content)
  const initialMsgCount = await page
    .locator(responseSel)
    .count()
    .catch(() => 0);
  // AI-response-only count (used by the extractor).
  // .ds-markdown only wraps AI responses, not user messages — this avoids
  // capturing the sent prompt text (which contains the <scope_doc> template).
  const initialAiBlockCount = await page
    .locator(".ds-markdown")
    .count()
    .catch(() => 0);

  return runPromptWorkflow(page, text, label, {
    providerName: "DeepSeek",
    injectText: injectDeepSeekText,
    clickSend: clickDeepSeekSend,
    waitForCompletion: async (pg, spinner) =>
      waitForDeepSeekCompletion(pg, initialMsgCount, sessionId),
    extractResponse: (pg) => extractDeepSeekResponse(pg, initialAiBlockCount),
    onFailure: (msg) => {
      log(
        colors.yellow(
          "Action: Check Chrome for Cloudflare or a 'Server Busy' message.",
        ),
      );
      return { ok: false, text: msg || "Timeout, Blocked, or Empty Response" };
    },
  });
}
