import { sessionManager } from "../../../session/index.js";
import { logger } from "#utils/logger.js";
import { extractAndNormalize } from "#utils/responseParser.js";
import { buildInitialPrompt } from "./prompts.js";
import { executeCoreTurn } from "./coreTurn.js";
import { handleRotationIfNeeded } from "./rotator.js";
import { handleStalls } from "./stallLoop.js";
import { gatherMetrics } from "./metrics.js";

export async function executeAskTurn(
  session,
  prompt,
  requestId,
  label = "API Turn",
  pollTimeoutMs = 420000,
  { skipConstraint = false, mode = null } = {},
) {
  sessionManager.logTranscript(session.id, "USER", prompt, { requestId });

  // --- [PARSE ERROR] short-circuit ---
  // If the calling system is re-sending a parse-error complaint about our last
  // response, attempt to repair that cached response server-side rather than
  // hitting DeepSeek again (which would just reproduce the same broken JSON).
  if (
    session.providerId === "deepseek" &&
    typeof prompt === "string" &&
    prompt.startsWith("[PARSE ERROR]") &&
    session.lastAiResponse
  ) {
    const { data, normalizedText } = extractAndNormalize(
      session.lastAiResponse,
    );
    if (data !== null && normalizedText !== session.lastAiResponse) {
      logger.info(
        `[Ask] [PARSE ERROR] short-circuit - returning server-repaired response for session ${session.id}`,
      );
      sessionManager.logTranscript(session.id, "AI", normalizedText, {
        requestId,
        messageCount: 0,
        repairedShortCircuit: true,
      });
      return { response: normalizedText, data, messageCount: 0 };
    }

    // If repair failed and the label suggests a read-only phase (researcher/scoper),
    // return [] directly — prose is the model signalling "done" with no tool calls.
    // Sending [PARSE ERROR] back to DeepSeek for a prose response in these phases
    // just triggers more prose, burning turns with no progress.
    const isReadOnlyLabel = /researcher|scoper|intent|orchestrat/i.test(label);
    if (isReadOnlyLabel) {
      logger.info(
        `[Ask] [PARSE ERROR] read-only phase prose detected — returning [] for session ${session.id} (label: ${label})`,
      );
      sessionManager.logTranscript(session.id, "AI", "[]", {
        requestId,
        messageCount: 0,
        proseTerminalShortCircuit: true,
      });
      return { response: "[]", data: [], messageCount: 0 };
    }

    logger.warn(
      `[Ask] [PARSE ERROR] short-circuit attempted but repair failed for session ${session.id} - proceeding normally`,
    );
  }

  if (session.page.isClosed()) {
    session.needsReset = true;
    const closedErr = new Error("Page closed — session needs reset");
    closedErr.stalled = true;
    throw closedErr;
  }
  await session.page.bringToFront();

  // Mid-session mode switch: ensure the browser is using the requested model/mode
  // before sending the prompt. Reused sessions might be on a different toggle.
  if (mode && typeof session.engine?.setMode === "function") {
    try {
      await session.engine.setMode(mode);
    } catch (err) {
      logger.warn(
        `[Ask] Failed to set mode ${mode} for session ${session.id}: ${err.message}`,
      );
    }
  }

  let activePrompt = buildInitialPrompt(
    session.providerId,
    prompt,
    skipConstraint,
    label,
  );

  const isReviewerTurn = /reviewer/i.test(label);

  let response = await executeCoreTurn(
    session,
    activePrompt,
    label,
    pollTimeoutMs,
  );

  // Rate-limit recovery: the provider returned a rate-limit message in its
  // response body. Retry with exponential back-off. ChatGPT's message limit
  // resets on an hourly cycle, so we try up to 3 times (45s → 3min → 10min).
  if (response.rateLimited) {
    const waits = [45000, 180000, 600000];
    for (const waitMs of waits) {
      logger.warn(
        `[Ask] Rate-limit detected for session ${session.id} — waiting ${waitMs / 1000}s then retrying in a fresh chat.`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      try {
        if (typeof session.engine?.startNewChat === "function") {
          await session.engine.startNewChat();
          logger.info(`[Ask] Started fresh chat after rate-limit wait.`);
        }
      } catch (e) {
        logger.warn(`[Ask] Failed to start new chat after rate limit: ${e.message}`);
      }
      response = await executeCoreTurn(session, activePrompt, label, pollTimeoutMs);
      if (!response.rateLimited) break;
      logger.warn(`[Ask] Still rate-limited after ${waitMs / 1000}s wait — extending back-off.`);
    }
  }

  if (isReviewerTurn && !response.ok) {
    logger.warn(
      `[Ask] Reviewer turn '${label}' failed - returning empty (no stall).`,
    );
    return { response: "", data: null, messageCount: 0 };
  }

  // On a content-filter refusal, retry with the bare prompt (no constraint prefix).
  // The constraint itself was likely what triggered the block - retrying with the
  // same prefix into a fresh chat would just cause another immediate block.
  const refusalRetryPrompt = response.isRefusal ? prompt : null;
  response = await handleRotationIfNeeded(
    session,
    response,
    activePrompt,
    refusalRetryPrompt,
  );

  if (isReviewerTurn && !response.ok) {
    logger.warn(
      `[Ask] Reviewer turn '${label}' failed after rotation - returning empty.`,
    );
    return { response: "", data: null, messageCount: 0 };
  }

  const stallResult = await handleStalls(session, response, activePrompt);
  if (stallResult.selfHealEscape) return stallResult;

  // Cache the raw AI response so that a subsequent [PARSE ERROR] turn can
  // short-circuit using a server-side repair rather than re-querying the model.
  session.lastAiResponse = stallResult.response;

  const { messageCount, data, normalizedText } = await gatherMetrics(
    session,
    stallResult.response,
  );

  // Use normalizedText as the returned response so the calling system's own
  // JSON.parse (which ignores our data field) receives clean, parseable JSON.
  const responseText =
    normalizedText !== undefined ? normalizedText : stallResult.response;

  sessionManager.logTranscript(session.id, "AI", responseText, {
    requestId,
    messageCount,
  });

  return {
    response: responseText,
    data,
    messageCount,
  };
}
