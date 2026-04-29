import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export function logChunkStart(chunkLabel, chunkTextContent) {
  let icon = "🚀";
  let colorFn = colors.cyan;

  if (chunkLabel.includes("Fix") || chunkLabel.includes("Nudge")) {
    icon = "🧠";
    colorFn = colors.yellow;
  } else if (chunkLabel.includes("Tool Results")) {
    icon = "🛠️";
    colorFn = colors.blue;
  }

  log(`\n${colorFn(`${icon} Injecting ${colors.bold(chunkLabel)}...`)}`);
}
