export const AI_MODES = {
  FAST: "fast",
  THINKING: "thinking",
  PRO: "pro",
  AUTO: "auto",
};

export function resolveModeKey(rawKey) {
  if (!rawKey) return AI_MODES.AUTO;
  const k = String(rawKey).toLowerCase();

  if (
    k === "thinkdeeper" ||
    k === "thinking" ||
    k === "o1" ||
    k === "o3" ||
    k === "deepthink" ||
    k === "r1" ||
    k === "fun"
  )
    return AI_MODES.THINKING;

  if (
    k === "fast" ||
    k === "quick" ||
    k === "4o-mini" ||
    k === "v3" ||
    k === "flash"
  )
    return AI_MODES.FAST;

  if (k === "pro") return AI_MODES.PRO;

  return AI_MODES.AUTO;
}

export const PROVIDER_MODES = {
  copilot: {
    [AI_MODES.FAST]: { label: "Quick", regex: /quick/i, key: "mode_quick" },
    [AI_MODES.THINKING]: {
      label: "Think Deeper",
      regex: /think deeper/i,
      key: "mode_think_deeper",
    },
    [AI_MODES.PRO]: { label: "Pro", regex: /pro/i, key: "mode_pro" },
    [AI_MODES.AUTO]: { label: "Auto", regex: /^auto$/i, key: "mode_auto" },
  },

  // Gemini's mode menu now uses opaque hashed test-ids
  // (e.g. bard-mode-option-56fdd199312815e2) and version-numbered labels
  // ("3.5 Flash", "3.5 Thinking", "3.1 Pro"). Both change over time, so each
  // option is matched by a stable keyword regex on its visible text instead.
  gemini: {
    [AI_MODES.FAST]: { label: "Fast", match: /flash/i },
    [AI_MODES.THINKING]: { label: "Thinking", match: /thinking/i },
    [AI_MODES.PRO]: { label: "Pro", match: /\bpro\b/i },
    [AI_MODES.AUTO]: { label: "Fast", match: /flash/i },
  },

  chatgpt: {
    [AI_MODES.FAST]: {
      label: "ChatGPT 4o",
      selector: 'button:has-text("GPT-4o")',
    },
    [AI_MODES.THINKING]: {
      label: "Reasoning (o1)",
      selector: 'button:has-text("o1")',
    },
    [AI_MODES.AUTO]: {
      label: "Auto",
      selector: 'button:has-text("Auto")',
    },
  },

  deepseek: {
    [AI_MODES.FAST]: {
      label: "DeepSeek-V3",
      selector: '.ds-switch-label:has-text("DeepThink")',
    },
    [AI_MODES.THINKING]: {
      label: "DeepSeek-R1",
      selector: '.ds-switch-label:has-text("DeepThink")',
    },
    [AI_MODES.AUTO]: {
      label: "DeepSeek-V3",
      selector: '.ds-switch-label:has-text("DeepThink")',
    },
  },

  grok: {
    [AI_MODES.AUTO]: { label: "Standard", selector: "" },
    [AI_MODES.THINKING]: { label: "Fun Mode", selector: "" },
  },
};
