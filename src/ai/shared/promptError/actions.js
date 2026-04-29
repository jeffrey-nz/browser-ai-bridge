import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { printResponseSummary } from "#copilot/client/interaction/prompt/summary.js";

export async function handleRetrySame() {
  log(colors.cyan("Retrying prompt injection..."));
  return { action: "retry_same" };
}

export async function handleRefresh(page) {
  log(colors.cyan("Refreshing page to clear stuck state..."));
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    log(
      colors.yellow(
        `  (Reload timed out or failed: ${err.message}. Attempting to continue...)`,
      ),
    );
  }

  try {
    await page.waitForTimeout(3000);
  } catch (err) {}

  return { action: "retry_same" };
}

export async function handleKeepWaiting() {
  log(colors.cyan("Resuming polling loop..."));
  return { action: "keep_waiting" };
}

export async function handleSkip() {
  return { action: "return", result: { ok: false, text: "" } };
}

export async function handleManual(rl, askLineFn) {
  const manualText = await askLineFn(
    rl,
    "Paste manual AI text (XML) to simulate a successful response:\n> ",
  );
  log(colors.green("Accepting manual input as AI response."));
  printResponseSummary(manualText);
  return { action: "return", result: { ok: true, text: manualText } };
}
