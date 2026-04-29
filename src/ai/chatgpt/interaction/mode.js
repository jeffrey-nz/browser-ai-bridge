import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function setChatGptMode(page, rawModeKey) {
  log(
    `\n⚙️  Skipping ChatGPT mode selection (using active browser default)...`,
  );
  return;
}
