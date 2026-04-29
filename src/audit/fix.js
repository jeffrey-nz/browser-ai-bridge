import process from "node:process";
import { forceCopyToClipboard } from "#tools/copyProjectToClipboard/clipboard.js";
import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

import { scanForFailures, loadSnapshotHtml } from "./fix/scanner.js";
import { askForProviderToFix } from "./fix/prompter.js";
import { generateLlmPrompt } from "./fix/generator.js";

async function runFix() {
  log(colors.cyan("\n=== AI Locator Fix Helper ==="));

  const scanResult = scanForFailures();

  if (scanResult.error) {
    log(colors.red(scanResult.error));
    process.exit(1);
  }

  if (scanResult.snapshots.length === 0) {
    log(colors.green("No failure snapshots found! Everything looks good."));
    process.exit(0);
  }

  const choice = await askForProviderToFix(scanResult.snapshots);

  if (choice === "CANCEL") {
    log(colors.yellow("Cancelled."));
    process.exit(0);
  }

  const { base, filename } = choice;

  const htmlContent = loadSnapshotHtml(scanResult.reportsDir, filename);
  const promptText = generateLlmPrompt(
    base,
    htmlContent,
    scanResult.reportData,
  );

  try {
    forceCopyToClipboard(promptText);
    log(
      colors.green(
        `\n[SUCCESS] Copied prompt, report, and HTML snapshot for ${base} to clipboard!`,
      ),
    );
    log(
      colors.dim(
        `Paste this into your preferred LLM to get the updated locator map.`,
      ),
    );
  } catch (err) {
    log(colors.red(`\n[ERROR] Failed to copy to clipboard: ${err.message}`));
  }
}

runFix().catch((err) => {
  console.error(err);
  process.exit(1);
});
