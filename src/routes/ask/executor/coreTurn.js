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
      const result = await session.engine.sendPromptWithFile(
        promptText,
        label,
        session.id,
        filePath,
      );
      if (result && !result.imageAttached) {
        logger.warn(
          `[Ask] ${session.providerId} could not confirm the image reached its composer — response is text-only despite the caller sending an image.`,
        );
      }
      return result;
    }
    if (attachmentPaths.length > 0) {
      // The caller sent an image, but this engine has no file-upload path at
      // all — sendPromptAndWait below has no attachment argument to give it,
      // so the image would otherwise be silently dropped and the turn come
      // back success:true with no way to tell it from a text-only answer
      // (T-004 on the crew board, found inside T-001's own fix). Run the
      // turn as text — there is nothing else to try — but mark it honestly
      // rather than let a caller mistake this for "no image was sent."
      logger.warn(
        `[Ask] ${session.providerId} has no sendPromptWithFile — the image cannot be sent; running as text-only.`,
      );
      const result = await session.engine.sendPromptAndWait(
        promptText,
        label,
        session.id,
        pollTimeoutMs,
      );
      return result ? { ...result, imageAttached: false } : result;
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
