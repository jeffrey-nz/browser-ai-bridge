// --- FILE START ---
// Relative Path: src/routes/ask/executor/stallLoop.js

import { logger } from "#utils/logger.js";
import { registerStall } from "../../../stalls.js";
import { capturePageContext } from "../../../heal/index.js";
import { executeCoreTurn } from "./coreTurn.js";
import { isWebMode } from "#web/mode.js";
import { cooldownManager } from "../../../session/CooldownManager.js";

export async function handleStalls(session, initialResponse, activePrompt) {
  let response = initialResponse;
  let stallAttempt = 0;

  while (!response.ok) {
    // In non-interactive (web / headless API) mode there is no human operator
    // to resolve a stall.  Skip immediately rather than waiting up to 10 minutes
    // for the stall timeout, which would hold the session lock and cause a
    // SESSION_BUSY cascade in the calling workflow.
    if (isWebMode() || !process.stdout.isTTY || !process.stdin.isTTY) {
      // If the provider triggered a cooldown (e.g. Gemini Error 13), wait for it
      // to expire and retry once — keeps recovery inside the bridge instead of
      // bouncing 503s back to the pipeline on every rate-limit hit.
      if (response.rateLimited) {
        const cd = cooldownManager.check(session.providerId);
        if (
          cd.active &&
          cd.remainingSeconds != null &&
          cd.remainingSeconds <= 150
        ) {
          const waitSecs = cd.remainingSeconds + 2;
          logger.info(
            `[Ask] Rate-limited — waiting ${waitSecs}s for ${session.providerId} cooldown before in-bridge retry (session ${session.id})...`,
          );
          await new Promise((r) => setTimeout(r, waitSecs * 1000));
          try {
            await session.engine.startNewChat();
          } catch (chatErr) {
            logger.warn(
              `[Ask] startNewChat failed during cooldown retry: ${chatErr.message}`,
            );
          }
          response = await executeCoreTurn(
            session,
            activePrompt,
            `API Turn (post-cooldown retry ${stallAttempt})`,
          );
          if (response.ok) return { response: response.text };
          logger.warn(
            `[Ask] Post-cooldown retry still failed — falling through to auto-skip.`,
          );
        }
      }

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
