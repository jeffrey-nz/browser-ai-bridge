/**
 * Provider-specific prompt constraint strings prepended to every outgoing turn.
 *
 * These address per-provider behavioural issues (wrong tool format, refusal to
 * use injected tools, unescaped JSON, etc.) and are kept here rather than inline
 * in prompts.js so that adding a new provider only requires one edit.
 *
 * Usage: buildInitialPrompt(providerId, prompt) in executor/prompts.js
 */

// ---------------------------------------------------------------------------
// Copilot 365
// ---------------------------------------------------------------------------
// Copilot 365 regularly responds "I don't have access to custom tools" despite
// the harness injecting them. This reasserts tool availability.
//
// IMPORTANT: Do NOT use "SYSTEM OVERRIDE", "DO NOT create Pages/Canvas/Loop",
// or other phrasing that explicitly names M365 product features — those exact
// phrases reliably trigger Copilot's content filter and cause chat blocks.
// Keep this instruction neutral and tool-focused only.

const COPILOT365_CONSTRAINT =
  "[Note: This session has a custom tool execution layer active. " +
  "The following tools are available and will be executed by the harness: " +
  "read_file, list_dir, find_file, write_file, patch_file, apply_diff, delete_file, execute_bash, grep, outline_file, http_request, run_composer, run_phpunit. " +
  "Use these tools by outputting JSON arrays as instructed. " +
  "If you are unsure whether a tool is available, assume it is — the harness handles execution. " +
  "Respond with JSON tool call arrays or markdown only.]\n\n";

// ---------------------------------------------------------------------------
// DeepSeek
// ---------------------------------------------------------------------------
// DeepSeek outputs unescaped double quotes inside JSON strings when content
// contains XML/HTML attributes. Wrapping in a ```json block suppresses markdown
// backslash-stripping that corrupts \" sequences in rendered text.

const DEEPSEEK_CONSTRAINT =
  "[FORMAT REQUIREMENT — READ CAREFULLY]\n" +
  "You MUST wrap ALL JSON tool call arrays in a ```json code block. " +
  "This is critical: the automation harness parses your response by looking for code blocks first. " +
  "Raw JSON outside a code block will NOT be detected.\n" +
  "CORRECT format:\n" +
  "```json\n" +
  '[{"tool": "write_file", "path": "/abs/path", "content": "file content here"}]\n' +
  "```\n" +
  'IMPORTANT: When the file content contains double-quote characters ("), you MUST escape them as \\" inside the JSON string. ' +
  'For example, XML like: <tag attr="value"> must be written as: <tag attr=\\"value\\"> in the JSON content field.\n\n';

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
// Gemini sometimes emits raw code directly instead of a write_file tool call,
// especially after a rollback. Wrapping in a ```json block also helps the
// response parser (code blocks checked first) and keeps logs readable.

const GEMINI_CONSTRAINT =
  "[FORMAT REQUIREMENT — READ CAREFULLY]\n" +
  "You MUST wrap ALL JSON tool call arrays in a ```json code block. " +
  "The automation harness parses your response by looking for code blocks first — raw JSON outside a code block may not be detected.\n" +
  "CORRECT format:\n" +
  "```json\n" +
  '[\n  { "tool": "write_file", "path": "/abs/path/to/File.cs", "content": "using System;\\n..." }\n]\n' +
  "```\n" +
  "WRONG — never output raw code or a bare JSON array outside a code block:\n" +
  "using System;\nnamespace Foo { ... }\n\n";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const CONSTRAINTS = {
  copilot365: COPILOT365_CONSTRAINT,
  deepseek: DEEPSEEK_CONSTRAINT,
  gemini: GEMINI_CONSTRAINT,
};

/**
 * Returns the prompt constraint string for the given provider, or "" if none.
 * The constraint is prepended to every outgoing prompt for the provider.
 */
export function buildPromptConstraint(providerId) {
  return CONSTRAINTS[providerId] ?? "";
}
