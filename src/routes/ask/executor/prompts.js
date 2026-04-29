// --- FILE START ---
// Relative Path: src/routes/ask/executor/prompts.js

import { buildPromptConstraint } from "../../../config/providerConstraints.js";

export function buildInitialPrompt(providerId, prompt, skipConstraint = false) {
  if (skipConstraint) return prompt;
  return buildPromptConstraint(providerId) + prompt;
}
