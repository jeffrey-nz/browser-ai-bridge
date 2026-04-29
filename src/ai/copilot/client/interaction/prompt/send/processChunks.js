import { prepareChunkPayload } from "./chunker.js";
import { sendSingleChunk } from "./sendSingleChunk.js";
import { handleAck } from "./chunkProcessors/ackHandler.js";
import { handleChunkFailure } from "./chunkProcessors/recoveryHandler.js";

export async function processChunks(page, chunks, label, sessionId = null, pollTimeoutMs = 420000) {
  let finalValidation = null;

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const chunkLabel =
      chunks.length > 1 ? `${label} (Part ${i + 1}/${chunks.length})` : label;

    const chunkTextContent = prepareChunkPayload(chunks[i], i, chunks.length);

    const expectedAck = chunks.length > 1 ? `PART ${i + 1} RECEIVED` : null;

    const result = await sendSingleChunk(
      page,
      chunkTextContent,
      chunkLabel,
      expectedAck,
      sessionId,
      pollTimeoutMs,
    );

    if (!result.success) {
      const recovery = result.recovery || {};

      if (recovery.action === "retry" || result.ok === false) {
        console.warn(
          `[Chunks] Part ${i + 1} failed to send. Halting sequence to prevent context corruption.`,
        );

        return {
          action: "return",
          result: {
            ok: false,
            reason: `Ingestion failed at Part ${i + 1}: ${recovery.reason || "Submission stuck"}`,
          },
        };
      }

      const { action, result: returnVal, retry } = handleChunkFailure(recovery);
      if (action === "return") return { action: "return", result: returnVal };
      if (retry) {
        i--;
        continue;
      }
      return {
        action: "return",
        result: { ok: false, reason: "Unrecoverable chunk error" },
      };
    }

    const { validation } = result;

    if (validation.action === "return") {
      return validation;
    }

    if (isLast) {
      finalValidation = validation;

      await page.waitForTimeout(3000);
    } else {
      await handleAck(page, validation, i);
    }
  }

  return finalValidation;
}
