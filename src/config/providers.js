import { GENERIC_SPECS } from "#ai/generic/specs.js";

//[[ The five sites added through the generic provider carry their own limits in
//   their spec, so this table does not need a hand-written line per site that
//   could drift from the thing it describes. ]]
const GENERIC_CONFIG = Object.fromEntries(
  Object.values(GENERIC_SPECS).map((s) => [
    s.id,
    { name: s.name, maxPromptChars: s.maxPromptChars },
  ]),
);

export const PROVIDER_CONFIG = {
  ...GENERIC_CONFIG,
  chatgpt: { name: "ChatGPT", maxPromptChars: 150000 },
  gemini: { name: "Google Gemini", maxPromptChars: 150000 },
  deepseek: { name: "DeepSeek", maxPromptChars: 150000 },
  grok: { name: "xAI Grok", maxPromptChars: 150000 },
  // Copilot's UI hard-limits the textarea at ~10,240 characters. We trim
  // aggressively down to ~9500 via fitToCharLimit so the prompt arrives in
  // a single message. File upload is too unreliable (Copilot's document
  // ingestion is flaky — chip appears but server says "no file attached"
  // on most attempts).
  copilot: { name: "Microsoft Copilot", maxPromptChars: 9500 },
};
