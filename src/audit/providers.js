import { CHATGPT_LOCATORS } from "#ai/chatgpt/locators.js";
import { GEMINI_LOCATORS } from "#ai/gemini/locators.js";
import { DEEPSEEK_LOCATORS } from "#ai/deepseek/locators.js";
import { GROK_LOCATORS } from "#ai/grok/locators.js";
import {
  COPILOT_LOCATORS,
  COPILOT_365_LOCATORS,
} from "#ai/copilot/client/locators.js";
import { stepCopilot365CanvasPage } from "./steps/copilot365CanvasPage.js";
import { stepGeminiModelDropdown } from "./steps/geminiModelDropdown.js";
import { stepDeepSeekModeToggle } from "./steps/deepseekModeToggle.js";

export const AUDIT_PROVIDERS = [
  {
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    locators: CHATGPT_LOCATORS,
    locatorsPath: "src/ai/chatgpt/locators.js",
    locatorsExport: "CHATGPT_LOCATORS",
  },
  {
    name: "Gemini",
    url: "https://gemini.google.com/app",
    locators: GEMINI_LOCATORS,
    locatorsPath: "src/ai/gemini/locators.js",
    locatorsExport: "GEMINI_LOCATORS",
    extraSteps: [
      {
        name: "6. Model Dropdown (Pro / Thinking / Fast Selection)",
        fn: stepGeminiModelDropdown,
        optional: true,
      },
    ],
  },
  {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    locators: DEEPSEEK_LOCATORS,
    locatorsPath: "src/ai/deepseek/locators.js",
    locatorsExport: "DEEPSEEK_LOCATORS",
    extraSteps: [
      {
        name: "6. Mode Toggles (Fast / Expert DeepThink Selection)",
        fn: (page) => stepDeepSeekModeToggle(page),
        optional: true,
      },
    ],
  },
  {
    name: "Grok",
    url: "https://grok.com/",
    locators: GROK_LOCATORS,
    locatorsPath: "src/ai/grok/locators.js",
    locatorsExport: "GROK_LOCATORS",
  },
  {
    name: "Copilot (Personal)",
    url: "https://copilot.microsoft.com/",
    locators: COPILOT_LOCATORS,
    locatorsPath: "src/ai/copilot/client/locators.js",
    locatorsExport: "COPILOT_LOCATORS",
  },
  {
    name: "Copilot 365 (Work)",
    url: "https://m365.cloud.microsoft/chat",
    locators: COPILOT_365_LOCATORS,
    locatorsPath: "src/ai/copilot/client/locators.js",
    locatorsExport: "COPILOT_365_LOCATORS",
    extraSteps: [
      {
        name: "6. Canvas Page Probe (Widget Detection & Selector Mapping)",
        fn: stepCopilot365CanvasPage,
        optional: true,
      },
    ],
  },
];
