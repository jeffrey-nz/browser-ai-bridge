const _enabled = process.env.BROWSER_AI_PROVIDERS
  ? new Set(
      process.env.BROWSER_AI_PROVIDERS.split(",").map((s) =>
        s.trim().toLowerCase(),
      ),
    )
  : null;

const ALL_PROVIDERS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    readySelector: '#prompt-textarea, [data-testid="composer-input"]',
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
    readySelector:
      'div.tiptap.ProseMirror, textarea[placeholder*="Ask Grok" i], textarea[placeholder*="Message Grok" i]',
  },
  {
    id: "copilot",
    name: "Microsoft Copilot (Personal)",
    url: "https://copilot.microsoft.com/",
    readySelector: '#userInput, [data-testid="composer-input"]',
  },
  {
    id: "copilot365",
    name: "Microsoft 365 Copilot (Work)",
    url: "https://m365.cloud.microsoft/chat",
    readySelector:
      '#m365-chat-editor-target-element, [data-lexical-editor="true"]',
  },
];

export const PROVIDERS_TO_LOGIN = _enabled
  ? ALL_PROVIDERS.filter((p) => _enabled.has(p.id))
  : ALL_PROVIDERS;
