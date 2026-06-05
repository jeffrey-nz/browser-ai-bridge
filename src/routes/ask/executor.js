// --- FILE START ---
// Relative Path: src/routes/ask/executor.js

import { sessionManager } from "../../session/index.js";
import { extractStructuredData } from "#utils/responseParser.js";
import { logger } from "#utils/logger.js";
import {
  registerStall,
  markActive,
  markActivePreserving,
  markInactive,
} from "../../stalls.js";
import { selfHeal, capturePageContext } from "../../heal/index.js";

// NOTE: This file is superseded by executor/index.js (active path). Keep in sync.
const DEEPSEEK_BASE_CONSTRAINT =
  "[FORMAT REQUIREMENT — READ CAREFULLY]\n" +
  "You MUST wrap ALL JSON tool call arrays in a ```json code block. " +
  "This is critical: the automation harness parses your response by looking for code blocks first. " +
  "Raw JSON outside a code block will NOT be detected.\n" +
  "CORRECT format:\n" +
  "```json\n" +
  '[{"tool": "write_file", "path": "/abs/path", "content": "file content here"}]\n' +
  "```\n" +
  'IMPORTANT: When the file content contains double-quote characters ("), you MUST escape them as \\" inside the JSON string. ' +
  'For example, C# code like: var x = "hello"; must be written as: var x = \\"hello\\"; in the JSON content field.\n\n';

export async function executeAskTurn(session, prompt, requestId) {
  sessionManager.log(
    session.id,
    `REQ ${requestId} START | ${prompt.length} chars`,
  );

  await session.page.bringToFront();

  // If the previous request on this session ended with a stall (page was left
  // in a broken or stopped state), reset to a clean context before sending the
  // new prompt.  Without this the first follow-up turn from coderNode after a
  // stall cascade would hit the same broken page and stall again immediately.
  if (session.needsReset) {
    logger.info(
      `[Ask] Session ${session.id.slice(0, 8)} flagged for reset after prior stall — resetting before new prompt.`,
    );
    session.needsReset = false;
    try {
      await session.engine.startNewChat();
    } catch (resetErr) {
      logger.warn(
        `[Ask] Pre-prompt reset failed: ${resetErr.message}. Proceeding anyway.`,
      );
    }
  }

  // Only inject the agent constraint for real agent turns (not plain API calls).
  const isApiTurn = !label || label === "API Turn" || label.startsWith("API Turn");
  let activePrompt = prompt;
  if (!isApiTurn && session.providerId === "deepseek") {
    activePrompt = DEEPSEEK_BASE_CONSTRAINT + prompt;
  }

  markActive(session.id);
  let response;
  try {
    response = await session.engine.sendPromptAndWait(
      activePrompt,
      "API Turn",
      session.id,
    );
  } catch (pollErr) {
    if (pollErr.controlAbort) {
      logger.info(
        "[Ask] Poll aborted by control signal — routing to stall resolver.",
      );
      response = { ok: false, reason: "control_abort" };
    } else {
      throw pollErr;
    }
  } finally {
    markInactive(session.id);
  }

  // Content policy refusal — rotating to a new chat won't help since the same
  // prompt will be rejected again. Flag the session for reset and surface a
  // clean CONTENT_REJECTED skip so the calling agent can retry with different
  // content rather than looping through the auto-rotation queue.
  if (!response.ok && response.isRefusal) {
    logger.warn(
      `[Ask] Content policy refusal detected — skipping turn without rotation. Reason: ${response.reason?.slice(0, 120)}`,
    );
    session.needsReset = true;
    const refusalErr = new Error(
      "TURN_SKIPPED: CONTENT_REJECTED — prompt was blocked by provider content policy",
    );
    refusalErr.stalled = true;
    throw refusalErr;
  }

  if (!response.ok && response.needsRotation) {
    logger.info(
      `[Ask] needsRotation detected (${response.reason?.slice(0, 80)}). Starting new chat and retrying...`,
    );
    await session.engine.startNewChat();

    markActivePreserving(session.id);

    try {
      response = await session.engine.sendPromptAndWait(
        activePrompt,
        "API Turn (retry)",
        session.id,
      );
    } catch (pollErr) {
      if (pollErr.controlAbort) {
        response = { ok: false, reason: "control_abort" };
      } else {
        throw pollErr;
      }
    } finally {
      markInactive(session.id);
    }
  }

  let stallAttempt = 0;
  const MAX_AUTO_ROTATION = 4;

  while (!response.ok) {
    // When Copilot is consistently returning errors (needsRotation), automatically
    // start a fresh chat and retry rather than blocking on human control.
    // This handles transient "Something went wrong" bursts without interrupting
    // the running automation session.
    if (response.needsRotation && stallAttempt < MAX_AUTO_ROTATION) {
      stallAttempt++;
      logger.info(
        `[Ask] Copilot error — auto-rotating to new chat (attempt ${stallAttempt}/${MAX_AUTO_ROTATION})...`,
      );

      // Brief pause to let the provider recover
      await new Promise((r) => setTimeout(r, 3000));
      await session.engine.startNewChat();

      markActive(session.id);
      try {
        response = await session.engine.sendPromptAndWait(
          activePrompt,
          `API Turn (auto-rotation ${stallAttempt})`,
          session.id,
        );
      } catch (pollErr) {
        if (pollErr.controlAbort) {
          response = { ok: false, reason: "control_abort" };
        } else {
          throw pollErr;
        }
      } finally {
        markInactive(session.id);
      }
      continue;
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
        data: null,
        messageCount: 0,
        selfHealEscape: true,
        htmlSnapshot: htmlSnippet || "",
      };
    } else if (
      control.action === "retry" ||
      control.action === "keep_waiting"
    ) {
      stallAttempt++;
      logger.info(
        `[Ask] Stall resolved: ${control.action} (attempt ${stallAttempt}). Re-running turn...`,
      );

      if (response.needsRotation) {
        logger.info(
          "[Ask] Stall retry: needsRotation flag set — starting new chat first.",
        );
        await session.engine.startNewChat();
      }

      markActive(session.id);
      try {
        response = await session.engine.sendPromptAndWait(
          activePrompt,
          `API Turn (stall retry ${stallAttempt})`,
          session.id,
        );
      } catch (pollErr) {
        if (pollErr.controlAbort) {
          response = { ok: false, reason: "control_abort" };
        } else {
          throw pollErr;
        }
      } finally {
        markInactive(session.id);
      }
    } else if (control.action === "manual") {
      logger.info("[Ask] Stall resolved: manual response accepted.");
      response = { ok: true, text: control.text };
    } else {
      logger.info("[Ask] Stall resolved: skipped by operator.");
      session.needsReset = true;
      const err = new Error("Turn skipped by human operator");
      err.stalled = true;
      throw err;
    }
  }

  sessionManager.log(
    session.id,
    `REQ ${requestId} OK | ${response.text.length} chars`,
  );

  let messageCount = 0;
  if (session.providerId?.includes("copilot")) {
    messageCount = await session.page
      .evaluate(
        () =>
          document.querySelectorAll(
            'div[id^="chatMessageResponse-"], [data-testid="m365-chat-llm-web-ui-chat-message"], [data-content="ai-message"], [data-testid="ai-message"], [data-testid="chat-message-content"], .message-content',
          ).length,
      )
      .catch(() => 0);
  }

  const parsedData = extractStructuredData(response.text);

  return {
    response: response.text,
    data: parsedData,
    messageCount,
  };
}
