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

  // Last-resort hard trim with a budget split that strongly favours head and
  // tail (where OUTPUT FORMAT / CRITICAL RULES live in agent prompts). The
  // middle gets a "[trimmed N chars]" marker so the model knows context was
  // dropped but the directive sections stay intact.
  const headBudget = Math.floor(limit * 0.6) - 100;
  const tailBudget = limit - headBudget - 200;
  const dropped = compacted.length - headBudget - tailBudget;
  const hardTrimmed =
    compacted.slice(0, headBudget) +
    `\n\n…[${dropped} chars trimmed from middle to fit ${providerName} hard limit; OUTPUT FORMAT and CRITICAL RULES preserved at start/end]…\n\n` +
    compacted.slice(-tailBudget);

  log(
    colors.yellow(
      `  Hard-trimmed mid-prompt to fit ${providerName} (${compacted.length} → ${hardTrimmed.length}).`,
    ),
  );

  return hardTrimmed;
}
