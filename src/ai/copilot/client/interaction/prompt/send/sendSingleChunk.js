import { logChunkStart } from "./chunkLogger.js";
import { verifyAck } from "./chunkValidator.js";
import { handleGenerationLoop } from "./chunkRecovery.js";
import { injectAndSubmit } from "./submitter.js";

export async function sendSingleChunk(
  page,
  chunkTextContent,
  chunkLabel,
  expectedAck = null,
  sessionId = null,
  pollTimeoutMs = 420000,
) {
  try {
    logChunkStart(chunkLabel, chunkTextContent);

    const submitResult = await injectAndSubmit(page, chunkTextContent);

    const genResult = await handleGenerationLoop(
      page,
      chunkTextContent,
      submitResult,
      sessionId,
      pollTimeoutMs,
    );
    if (!genResult.success) return genResult;

    return await verifyAck(page, expectedAck);
  } catch (err) {
    if (err.controlAbort || err.message?.includes("Aborted")) throw err;
    return {
      success: false,
      recovery: {
        action: "return",
        result: { ok: false, reason: err.message },
      },
    };
  }
}
