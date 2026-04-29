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
    throw pollErr;
  } finally {
    markInactive(session.id);
  }
}
