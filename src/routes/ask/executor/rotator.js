// --- FILE START ---
// Relative Path: src/routes/ask/executor/rotator.js

import { logger } from "#utils/logger.js";
import { markActivePreserving, markInactive } from "../../../stalls.js";

export async function handleRotationIfNeeded(
  session,
  currentResponse,
  activePrompt,
  refusalRetryPrompt = null,
) {
  if (currentResponse.ok || !currentResponse.needsRotation) {
    return currentResponse;
  }

  // If this was a content-filter refusal AND the caller provided a constraint-free
  // fallback prompt, use that instead of the full activePrompt so we don't send
  // the same blocked text into the fresh chat.
  const retryPrompt = (currentResponse.isRefusal && refusalRetryPrompt)
    ? refusalRetryPrompt
    : activePrompt;

  if (currentResponse.isRefusal) {
    logger.info(
      `[Ask] Content-filter refusal detected — retrying in fresh chat without constraint prefix.`,
    );
  } else {
    logger.info(
      `[Ask] needsRotation detected (${currentResponse.reason?.slice(0, 80)}). Starting new chat and retrying...`,
    );
  }

  // Attempt to start a new chat context before retrying.
  // startNewChat can throw if the page is in a broken state (e.g. the
  // "Something went wrong" error leaves the composer permanently disabled).
  // We catch this so the failure is returned as a normal response rather than
  // an unhandled exception — the stall handler can then let the operator decide.
  try {
    await session.engine.startNewChat();
  } catch (chatErr) {
    logger.warn(`[Ask] startNewChat failed during rotation: ${chatErr.message}`);
    // Return a stall-eligible failure rather than throwing so handleStalls
    // can offer the operator retry/skip options.
    return {
      ok: false,
      needsRotation: false, // don't auto-rotate again; let human decide
      reason: `Rotation failed — could not start new chat: ${chatErr.message}`,
    };
  }

  markActivePreserving(session.id);

  let newResponse;
  try {
    newResponse = await session.engine.sendPromptAndWait(
      retryPrompt,
      currentResponse.isRefusal ? "API Turn (refusal retry)" : "API Turn (retry)",
      session.id,
    );
  } catch (pollErr) {
    if (pollErr.controlAbort) {
      newResponse = { ok: false, reason: "control_abort" };
    } else {
      throw pollErr;
    }
  } finally {
    markInactive(session.id);
  }

  return newResponse;
}