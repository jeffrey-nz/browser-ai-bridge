import { sessionManager } from "../../../session/index.js";
import { logger } from "#utils/logger.js";
import { extractAndNormalize } from "#utils/responseParser.js";
import { buildInitialPrompt } from "./prompts.js";
import { executeCoreTurn } from "./coreTurn.js";
import { handleRotationIfNeeded } from "./rotator.js";
import { handleStalls } from "./stallLoop.js";
import { gatherMetrics } from "./metrics.js";
import { saveImagesToTempFiles, cleanupTempFiles } from "./imageAttachments.js";

export async function executeAskTurn(
  session,
  prompt,
  requestId,
  label = "API Turn",
  pollTimeoutMs = 420000,
  {
    skipConstraint = false,
    mode = null,
    images = [],
    projectDir = "",
    yieldOnRateLimit = false,
  } = {},
) {
  const attachmentPaths = images.length
    ? await saveImagesToTempFiles(images)
    : [];
  try {
    return await runAskTurn(session, prompt, requestId, label, pollTimeoutMs, {
      skipConstraint,
      mode,
      attachmentPaths,
      projectDir,
      yieldOnRateLimit,
    });
  } finally {
    if (attachmentPaths.length) await cleanupTempFiles(attachmentPaths);
  }
}

async function runAskTurn(
  session,
  prompt,
  requestId,
  label,
  pollTimeoutMs,
  {
    skipConstraint,
    mode,
    attachmentPaths,
    projectDir = "",
    yieldOnRateLimit = false,
  },
) {
  sessionManager.logTranscript(session.id, "USER", prompt, { requestId });

  // T-011: how far into this session's life this turn was taken. Computed
  // once per turn rather than per return point so every exit from this
  // function — short-circuit, reviewer-empty, or the normal path — reports
  // the same pair. A caller collecting answers over an unattended run (e.g.
  // mmg's per-bar sweep) can order them without a second call to /api/ping
  // or joining session createdAt back in by wall clock.
  session.turnCount = (session.turnCount || 0) + 1;
  const turnIndex = session.turnCount;
  const sessionAgeMs = Date.now() - session.createdAt.getTime();

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
        turnIndex,
        repairedShortCircuit: true,
      });
      return { response: normalizedText, data, turnIndex, sessionAgeMs };
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
        turnIndex,
        proseTerminalShortCircuit: true,
      });
      return { response: "[]", data: [], turnIndex, sessionAgeMs };
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
    projectDir,
  );

  const isReviewerTurn = /reviewer/i.test(label);

  let response = await executeCoreTurn(
    session,
    activePrompt,
    label,
    pollTimeoutMs,
    { attachmentPaths },
  );

  // "A message is being generated" recovery: a previous DeepSeek generation was
  // still in flight when we submitted. Wait briefly then retry in the same chat
  // (no new chat — the session is fine, just busy). Use 3 retries: 20s, 30s, 60s.
  if (response.busyGenerating) {
    const waits = [20000, 30000, 60000].map((w) =>
      Math.floor(w * (0.75 + Math.random() * 0.5)),
    );
    for (const waitMs of waits) {
      logger.warn(
        `[Ask] DeepSeek busy (still generating) for session ${session.id} — waiting ${waitMs / 1000}s then retrying.`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      response = await executeCoreTurn(
        session,
        activePrompt,
        label,
        pollTimeoutMs,
        { attachmentPaths },
      );
      if (!response.busyGenerating) break;
    }
  }

  // Rate-limit recovery: the provider returned a rate-limit message in its
  // response body. Retry with back-off. DeepSeek "Messages too frequent" typically
  // resets in 1-2 min; ChatGPT hourly. Use 4 retries: 90s, 90s, 120s, 300s.
  if (response.rateLimited) {
    //[[ YIELD RATHER THAN SLEEP, when somebody else can answer.
    //
    //   The back-off below is 90s, 90s, 120s, 300s -- up to nine and a half
    //   minutes of doing nothing, waiting for the SAME provider to forgive us.
    //   That is the right behaviour when it is the only provider there is, and
    //   the wrong behaviour by an order of magnitude when the caller named a
    //   tier chain: a rate limit is a property of an account and a clock, and
    //   says nothing about whether the next tier could answer right now.
    //
    //   So when the route has somewhere else to go, this returns immediately
    //   and lets it. The cooldown the provider was just put on is what makes
    //   the fallback temporary -- the chain prefers tier 0 again the moment it
    //   clears, so nothing here has to remember to switch back. ]]
    if (yieldOnRateLimit) {
      logger.warn(
        `[Ask] Rate-limited on ${session.providerId} — yielding to the next tier ` +
          `instead of waiting ${Math.round(90)}s+ for the same one.`,
      );
      const err = new Error("RATE_LIMITED");
      err.stalled = true;
      err.rateLimited = true;
      throw err;
    }

    const waits = [90000, 90000, 120000, 300000].map((w) =>
      Math.floor(w * (0.75 + Math.random() * 0.5)),
    );
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
        logger.warn(
          `[Ask] Failed to start new chat after rate limit: ${e.message}`,
        );
      }
      response = await executeCoreTurn(
        session,
        activePrompt,
        label,
        pollTimeoutMs,
        { attachmentPaths },
      );
      if (!response.rateLimited) break;
      logger.warn(
        `[Ask] Still rate-limited after ${waitMs / 1000}s wait — extending back-off.`,
      );
    }
  }

  if (isReviewerTurn && !response.ok) {
    logger.warn(
      `[Ask] Reviewer turn '${label}' failed - returning empty (no stall).`,
    );
    return { response: "", data: null, turnIndex, sessionAgeMs };
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
    return { response: "", data: null, turnIndex, sessionAgeMs };
  }

  const stallResult = await handleStalls(session, response, activePrompt);
  if (stallResult.selfHealEscape) return stallResult;

  // Cache the raw AI response so that a subsequent [PARSE ERROR] turn can
  // short-circuit using a server-side repair rather than re-querying the model.
  session.lastAiResponse = stallResult.response;

  const { data, normalizedText } = await gatherMetrics(
    session,
    stallResult.response,
  );

  // Use normalizedText as the returned response so the calling system's own
  // JSON.parse (which ignores our data field) receives clean, parseable JSON.
  const responseText =
    normalizedText !== undefined ? normalizedText : stallResult.response;

  sessionManager.logTranscript(session.id, "AI", responseText, {
    requestId,
    turnIndex,
  });

  return {
    response: responseText,
    data,
    turnIndex,
    sessionAgeMs,
    imageAttached: stallResult.imageAttached,
    imageAttachedCause: stallResult.imageAttachedCause,
  };
}
