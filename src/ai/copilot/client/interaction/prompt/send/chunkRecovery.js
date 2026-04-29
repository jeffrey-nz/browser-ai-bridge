import { createSpinner } from "#app/ui/spinner.js";
import { handlePromptError } from "#ai/shared/promptError/index.js";
import { waitForCompletion } from "../poll/index.js";
import { injectAndSubmit } from "./submitter.js";

const errorOpts = {
  includeKeepWaiting: true,
  useDashboard: true,
  timeoutMs: 120000,
};

export async function handleGenerationLoop(
  page,
  chunkTextContent,
  submitResult,
  sessionId = null,
  pollTimeoutMs = 420000,
) {
  let spinner = createSpinner(`AI is generating response...`).start();
  let completed = await waitForCompletion(
    page,
    submitResult,
    spinner,
    sessionId,
    pollTimeoutMs,
  );

  while (!completed) {
    const recovery = await handlePromptError(
      new Error("AI generation stalled."),
      page,
      spinner,
      {},
      errorOpts,
    );

    if (recovery.action === "keep_waiting") {
      spinner = createSpinner(`AI is generating response...`).start();
      completed = await waitForCompletion(
        page,
        submitResult,
        spinner,
        sessionId,
        pollTimeoutMs,
      );
    } else if (recovery.action === "retry_same") {
      const newSubmit = await injectAndSubmit(page, chunkTextContent);
      spinner = createSpinner(`AI is generating response...`).start();
      completed = await waitForCompletion(
        page,
        newSubmit,
        spinner,
        sessionId,
        pollTimeoutMs,
      );
    } else {
      return { success: false, recovery };
    }
  }

  spinner.succeed(`Response received.`);
  return { success: true };
}
