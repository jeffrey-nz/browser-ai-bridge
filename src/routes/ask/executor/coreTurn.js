import { logger } from "#utils/logger.js";
import { markActive, markInactive } from "../../../stalls.js";

export async function executeCoreTurn(
  session,
  promptText,
  label,
  pollTimeoutMs,
  { attachmentPaths = [] } = {},
) {
  markActive(session.id);
  try {
    if (
      attachmentPaths.length > 0 &&
      typeof session.engine?.sendPromptWithFile === "function"
    ) {
      // Only the first attachment is forwarded — current providers accept one
      // image per turn. Multi-image support would require provider-side changes.
      const filePath = attachmentPaths[0];
      if (attachmentPaths.length > 1) {
        logger.warn(
          `[Ask] ${attachmentPaths.length} attachments queued, but provider only supports 1 — sending first.`,
        );
      }
      return await session.engine.sendPromptWithFile(
        promptText,
        label,
        session.id,
        filePath,
      );
    }
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
