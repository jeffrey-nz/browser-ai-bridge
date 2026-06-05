import { buildPromptConstraint } from "../../../config/providerConstraints.js";

export function buildInitialPrompt(
  providerId,
  prompt,
  skipConstraint = false,
  label = "",
  projectDir = "",
) {
  if (skipConstraint) return prompt;

  // "API Turn" is the label used for plain /api/ask calls (translation,
  // definitions, alignment) — not agent tool-use tasks. Injecting the
  // FORMAT REQUIREMENT (write_file tool-call format) into these prompts
  // confuses the model into echoing the constraint or producing wrong output.
  // Only inject provider constraints for real agent task labels.
  const isApiTurn = !label || label === "API Turn" || label.startsWith("API Turn");
  if (isApiTurn) return prompt;

  return buildPromptConstraint(providerId, label, projectDir) + prompt;
}
