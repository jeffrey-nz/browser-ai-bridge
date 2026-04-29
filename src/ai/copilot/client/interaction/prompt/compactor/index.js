import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { getCharLimit } from "./constants.js";
import { truncateBlocks } from "./truncators/blocks.js";
import { compactToolList } from "./truncators/tools.js";
import { truncateMemory } from "./truncators/memory.js";

export { getCharLimit };

export function fitToCharLimit(text, providerName = "copilot") {
  const limit = getCharLimit(providerName);

  if (text.length <= limit) return text;

  log(
    colors.yellow(
      `\n⚠️ Message too long (${text.length}/${limit} chars). Compacting for ${providerName}...`,
    ),
  );

  let compacted = text;

  const blockLimit = providerName === "gemini" ? 600 : 2000;
  compacted = truncateBlocks(compacted, blockLimit);

  if (compacted.length <= limit) {
    log(colors.dim(`  Compacted heavy blocks to fit ${providerName} limit.`));
    return compacted;
  }

  compacted = compactToolList(compacted);
  if (compacted.length <= limit) return compacted;

  compacted = truncateMemory(compacted);
  if (compacted.length <= limit) return compacted;

  log(
    colors.yellow(
      `  ⚠️ Message still over limit (${compacted.length}/${limit}). Delegating to multi-turn chunking.`,
    ),
  );

  return compacted;
}
