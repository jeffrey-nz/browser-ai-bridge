import { logger } from "#utils/logger.js";
import { markActive, markInactive } from "../../../stalls.js";

export async function executeCoreTurn(
  session,
  promptText,
  label,
  pollTimeoutMs,
) {
  markActive(session.id);
  try {
    return await session.engine.sendPromptAndWait(
      promptText,
      label,
      session.id,
      pollTimeoutMs,
    );
  } catch (pollErr) {
    if (pollErr.controlAbort) {
      logger.info(
        "[Ask] Poll aborted by control signal — routing to stall resolver.",
      );
      return { ok: false, reason: "control_abort" };
    }
    // Session-abort from client disconnect: treat as a clean early exit so
    // the finally block can run cleanupAutoSession and close the browser tab.
    if (pollErr.message?.includes("Aborted")) {
      logger.info(
        `[Ask] Poll aborted (client disconnect) — releasing session ${session.id.slice(0, 8)}`,
      );
      const abortErr = new Error("Session aborted by client disconnect");
      abortErr.clientAbort = true;
      abortErr.stalled = true;
      throw abortErr;
    }
    throw pollErr;
  } finally {
    markInactive(session.id);
  }
}
