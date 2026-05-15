export const PROVIDER_CONFIG = {
  chatgpt: { name: "ChatGPT", maxPromptChars: 150000 },
  gemini: { name: "Google Gemini", maxPromptChars: 150000 },
  deepseek: { name: "DeepSeek", maxPromptChars: 150000 },
  grok: { name: "xAI Grok", maxPromptChars: 150000 },
  // Bumped from 32k to 100k: the earlier limit triggered the chunker for any
  // agent prompt, and Copilot doesn't reliably emit the "PART N RECEIVED" ack
  // the chunker expects — projectManager turns stalled indefinitely. 100k is
  // well within Copilot's actual UI capacity and skips chunking for typical
  // agent traffic.
  copilot: { name: "Microsoft Copilot", maxPromptChars: 100000 },
};
