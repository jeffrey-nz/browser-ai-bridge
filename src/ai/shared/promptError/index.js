import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { dumpPageHtml } from "#ai/shared/domInteraction.js";
import {
  makeRl,
  closeRl,
  promptChoice,
  askLine,
} from "#app/ui/readline/index.js";
import {
  suspendDashboardForPrompt,
  resumeDashboardAfterPrompt,
} from "#app/ui/dashboard.js";
import { getPromptChoice } from "./prompter.js";
import * as actions from "./actions.js";
import { isWebMode } from "#web/mode.js";
import process from "node:process";

export async function handlePromptError(
  err,
  page,
  spinner,
  deps = {},
  opts = {},
) {
  const {
    makeRlFn = makeRl,
    closeRlFn = closeRl,
    promptChoiceFn = promptChoice,
    askLineFn = askLine,
  } = deps;

  const { includeKeepWaiting = false, useDashboard = false, timeoutMs } = opts;

  if (spinner) {
    try {
      spinner.stop();
    } catch (e) {}
  }

  log(`\n${colors.bgRed(" ⚠️  FATAL INTERACTION ERROR ")} ${err.message}`);

  if (isWebMode() || !process.stdout.isTTY || !process.stdin.isTTY) {
    log(
      colors.yellow(
        "\n[Auto-Recovery] Non-interactive API mode detected. Aborting turn to prevent hanging.",
      ),
    );
    return {
      action: "return",
      result: { ok: false, text: err.message || "Fatal Interaction Error" },
    };
  }

  if (useDashboard) suspendDashboardForPrompt();

  log(
    colors.yellow(
      "\nAutomation paused. Instead of breaking, you can manually intervene.",
    ),
  );

  const rl = makeRlFn();
  const choice = await getPromptChoice(
    rl,
    promptChoiceFn,
    includeKeepWaiting,
    timeoutMs,
  );

  let resultData;
  if (choice === "retry_same") resultData = await actions.handleRetrySame();
  else if (choice === "refresh") resultData = await actions.handleRefresh(page);
  else if (choice === "keep_waiting")
    resultData = await actions.handleKeepWaiting();
  else if (choice === "skip") resultData = await actions.handleSkip();
  else if (choice === "manual")
    resultData = await actions.handleManual(rl, askLineFn);
  else
    resultData = { action: "return", result: { ok: false, text: err.message } };

  closeRlFn(rl);
  if (useDashboard) resumeDashboardAfterPrompt();

  return resultData;
}
