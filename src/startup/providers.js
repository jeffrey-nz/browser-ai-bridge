import { GENERIC_SPECS } from "#ai/generic/specs.js";
import { CHATGPT_LOCATORS } from "#ai/chatgpt/locators.js";
import { GROK_LOCATORS } from "#ai/grok/locators.js";

// BROWSER_AI_PROVIDERS as a Set of lower-cased ids, or null when unset (all).
export function parseEnabledProviders(
  envValue = process.env.BROWSER_AI_PROVIDERS,
) {
  if (!envValue) return null;
  return new Set(envValue.split(",").map((s) => s.trim().toLowerCase()));
}

const _enabled = parseEnabledProviders();

//[[ Generated from the specs rather than restated, so a selector fix in one place
//   cannot leave the startup readiness probe looking for the old one. ]]
const GENERIC_STARTUP = Object.values(GENERIC_SPECS).map((s) => ({
  id: s.id,
  name: s.name,
  url: s.url,
  readySelector: s.locators.inputBox,
}));

const ALL_PROVIDERS = [
  ...GENERIC_STARTUP,
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    readySelector: CHATGPT_LOCATORS.inputBox,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    url: "https://gemini.google.com/app",
    readySelector: 'rich-textarea, div.ql-editor[contenteditable="true"]',
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    readySelector:
      '#chat-input, textarea.ds-scroll-area, textarea[placeholder*="DeepSeek" i]',
  },
  {
    id: "grok",
    name: "xAI Grok",
    url: "https://grok.com/",
    readySelector: GROK_LOCATORS.inputBox,
  },
  {
    id: "copilot",
    name: "Microsoft Copilot (Personal)",
    url: "https://copilot.microsoft.com/",
    readySelector: '#userInput, [data-testid="composer-input"]',
  },
];

export const PROVIDERS_TO_LOGIN = _enabled
  ? ALL_PROVIDERS.filter((p) => _enabled.has(p.id))
  : ALL_PROVIDERS;
