// --- FILE START ---
// Relative Path: src/routes/ask/executor/stallLoop.js

import { logger } from "#utils/logger.js";
import { registerStall } from "../../../stalls.js";
import { capturePageContext } from "../../../heal/index.js";
import { executeCoreTurn } from "./coreTurn.js";
import { isWebMode } from "#web/mode.js";

export async function handleStalls(session, initialResponse, activePrompt) {
  let response = initialResponse;
  let stallAttempt = 0;

  while (!response.ok) {
    // In non-interactive (web / headless API) mode there is no human operator
    // to resolve a stall.  Skip immediately rather than waiting up to 10 minutes
    // for the stall timeout, which would hold the session lock and cause a
    // SESSION_BUSY cascade in the calling workflow.
    if (isWebMode() || !process.stdout.isTTY || !process.stdin.isTTY) {
      logger.warn(
        `[Ask] Turn failed (attempt ${stallAttempt}) — non-interactive mode, auto-skipping stall for session ${session.id}.`,
      );
      session.needsReset = true;
      const err = new Error("Turn skipped (non-interactive auto-skip)");
      err.stalled = true;
      if (response.rateLimited) err.rateLimited = true;
      throw err;
    }

    logger.warn(
      `[Ask] Turn failed (attempt ${stallAttempt}). Awaiting human control for session ${session.id}...`,
    );
    const control = await registerStall(session.id);

    if (control.action === "self_heal") {
      logger.info(
        "[Ask] Stall resolved: self_heal — capturing page snapshot for API handoff...",
      );
      const { htmlSnippet } = await capturePageContext(session.page);
      return {
        response: "",
        selfHealEscape: true,
        htmlSnapshot: htmlSnippet || "",
      };
    }

    if (control.action === "retry" || control.action === "keep_waiting") {
      stallAttempt++;
      logger.info(
        `[Ask] Stall resolved: ${control.action} (attempt ${stallAttempt}). Re-running turn...`,
      );

      if (response.needsRotation) {
        logger.info(
          "[Ask] Stall retry: needsRotation flag set — starting new chat first.",
        );
        try {
          await session.engine.startNewChat();
        } catch (chatErr) {
          // Don't let a failed chat rotation abort the stall loop.
          // Log it and re-enter the stall so the operator can try again or skip.
          logger.warn(
            `[Ask] startNewChat failed in stall retry: ${chatErr.message}. Re-entering stall.`,
          );
          response = {
            ok: false,
            needsRotation: true,
            reason: chatErr.message,
          };
          continue;
        }
      }

      response = await executeCoreTurn(
        session,
        activePrompt,
        `API Turn (stall retry ${stallAttempt})`,
      );
      continue;
    }

    if (control.action === "manual") {
      logger.info("[Ask] Stall resolved: manual response accepted.");
      return { response: control.text };
    }

    logger.info("[Ask] Stall resolved: skipped by operator.");
    session.needsReset = true;
    const err = new Error("Turn skipped by human operator");
    err.stalled = true;
    throw err;
  }

  return { response: response.text };
}
