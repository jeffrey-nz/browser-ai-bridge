import { buildPromptConstraint } from "../../../config/providerConstraints.js";

export function buildInitialPrompt(
  providerId,
  prompt,
  skipConstraint = false,
  label = "",
) {
  if (skipConstraint) return prompt;
  return buildPromptConstraint(providerId, label) + prompt;
}
