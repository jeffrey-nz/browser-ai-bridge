import { log } from "#app/ui/log.js";

export async function setGrokMode(page, rawModeKey) {
  log(`\n⚙️ Skipping Grok mode selection (using active browser default)...`);
  return;
}
