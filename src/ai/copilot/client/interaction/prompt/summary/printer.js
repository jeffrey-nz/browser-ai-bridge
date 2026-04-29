import { logRaw } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

const BOX_WIDTH = 65;

export function printSummaryBox(aiSummary) {
  logRaw(
    `\n  ${colors.magenta(`╭── 🧠 AI Summary ${"─".repeat(BOX_WIDTH - 18)}`)}`,
  );
  const summaryLines = aiSummary.split("\n");
  for (const line of summaryLines) {
    logRaw(`  ${colors.magenta("│")} ${colors.bold(line)}`);
  }
  logRaw(`  ${colors.magenta(`╰${"─".repeat(BOX_WIDTH - 1)}`)}`);
}

export function printRawSnippet(text) {
  const cleanSnippet = text.slice(0, 300).replace(/\n/g, " ").trim();
  logRaw(`\n  ${colors.dim(`╭── Raw Response ${"─".repeat(BOX_WIDTH - 14)}`)}`);
  logRaw(`  ${colors.dim("│")} ${colors.dim(cleanSnippet + "...")}`);
  logRaw(`  ${colors.dim(`╰${"─".repeat(BOX_WIDTH - 1)}`)}`);
}

export function printTagsBox(tagLines) {
  if (!tagLines || tagLines.length === 0) return;

  logRaw(
    `\n  ${colors.cyan(`╭── 🏷️  AI Response Tags ${"─".repeat(BOX_WIDTH - 24)}`)}`,
  );
  for (const line of tagLines) {
    logRaw(`  ${colors.cyan("│")} ${colors.dim(line.trim())}`);
  }
  logRaw(`  ${colors.cyan(`╰${"─".repeat(BOX_WIDTH - 1)}`)}`);
}
