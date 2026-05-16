/**
 * Provider-specific prompt constraint strings prepended to every outgoing turn.
 *
 * These address per-provider behavioural issues (wrong tool format, refusal to
 * use injected tools, unescaped JSON, etc.) and are kept here rather than inline
 * in prompts.js so that adding a new provider only requires one edit.
 *
 * Usage: buildPromptConstraint(providerId, label) in executor/prompts.js
 */

// ---------------------------------------------------------------------------
// DeepSeek
// ---------------------------------------------------------------------------
// DeepSeek outputs unescaped double quotes inside JSON strings when content
// contains XML/HTML attributes. Wrapping in a ```json block suppresses
// backslash-stripping that corrupts \" sequences in rendered text.
//
// The constraint uses a phase-appropriate example tool call:
//  - researcher/scoper phases → read_file example (these are read-only; showing
//    write_file confuses DeepSeek when writes are blocked with READ-ONLY errors)
//  - all other phases        → write_file example

function deepseekConstraint(isReadOnly) {
  const example = isReadOnly
    ? '[{"tool": "read_file", "path": "/abs/path/to/file.js"}]'
    : '[{"tool": "write_file", "path": "/abs/path", "content": "file content here"}]';

  return (
    "[FORMAT REQUIREMENT — READ CAREFULLY]\n" +
    "You MUST wrap ALL JSON tool call arrays in a ```json code block. " +
    "This is critical: the automation harness parses your response by looking for code blocks first. " +
    "Raw JSON outside a code block will NOT be detected.\n" +
    "CORRECT format:\n" +
    "```json\n" +
    example +
    "\n" +
    "```\n" +
    "If you have completed your analysis and have no further tool calls to make, " +
    "respond with an empty array:\n" +
    "```json\n[]\n```\n" +
    "Do NOT respond with prose when you have nothing more to do — always use the JSON format.\n" +
    'IMPORTANT: When file content contains double-quote characters ("), escape them as \\" inside the JSON string.\n\n'
  );
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const GEMINI_CONSTRAINT =
  "[FORMAT REQUIREMENT — READ CAREFULLY]\n" +
  "You MUST wrap ALL JSON tool call arrays in a ```json code block. " +
  "The automation harness parses your response by looking for code blocks first — raw JSON outside a code block may not be detected.\n" +
  "CORRECT format:\n" +
  "```json\n" +
  '[\n  { "tool": "write_file", "path": "/abs/path/to/File.cs", "content": "using System;\\n..." }\n]\n' +
  "```\n" +
  "If you have no tool calls to make, respond with:\n" +
  "```json\n[]\n```\n" +
  "CRITICAL RESTRICTIONS:\n" +
  "- NEVER create a Canvas document, immersive view, or artifact panel. Do NOT use the 'Create a document' or 'Canvas' feature.\n" +
  "- Output ALL content — code, JSON, file contents — directly in the chat response as ```json or ``` code blocks.\n" +
  "- NEVER put file contents into a separate document or side panel; always use the write_file tool with the content embedded in JSON.\n" +
  "- WRONG — never output raw code or a bare JSON array outside a code block.\n\n";

// ---------------------------------------------------------------------------
// Copilot (Personal)
// ---------------------------------------------------------------------------
// Microsoft Copilot Personal refuses to output JSON "tool call arrays" because
// it interprets "write_file" as a file-system tool it cannot execute.
// Instead, instruct it to use a custom <<<FILE: path>>> delimiter format.
// The agent-core StructuredOutputParser has a dedicated Strategy 7 that
// extracts these blocks and converts them to synthetic write_file tool calls.

function copilotConstraint(isReadOnly) {
  if (isReadOnly) {
    return (
      "[RESPONSE FORMAT — FOLLOW EXACTLY]\n" +
      "Do NOT write any files. Do NOT use <<<FILE:>>> format. Do NOT output JSON tool-call arrays.\n" +
      "Respond in the format your instructions specify (prose, JSON plan, etc.).\n\n"
    );
  }
  return (
    "[FILE OUTPUT FORMAT — FOLLOW EXACTLY]\n" +
    "Do NOT output JSON arrays. Do NOT use any 'tool call' or 'write_file' syntax.\n" +
    "To create or modify a file, use this EXACT delimiter format:\n\n" +
    "<<<FILE: /absolute/path/to/filename.ext>>>\n" +
    "complete file content here\n" +
    "<<<END FILE>>>\n\n" +
    "Example:\n" +
    "<<<FILE: /Users/jeffrey/chess/index.html>>>\n" +
    "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<body>Chess Game</body>\n" +
    "</html>\n" +
    "<<<END FILE>>>\n\n" +
    "Write ALL required files using this format, then end your response with: TASK_DONE\n" +
    "IMPORTANT: This is NOT a tool execution — <<<FILE:>>> is just a text format for communicating file contents.\n\n"
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Returns the prompt constraint string for the given provider.
 * Pass the turn label so the constraint can use a phase-appropriate example.
 */
export function buildPromptConstraint(providerId, label = "") {
  const labelLow = label.toLowerCase();
  const isReadOnly = /researcher|scoper|intent|orchestrat|debug|manager|plan|verif|critic|review/.test(labelLow);

  switch (providerId) {
    case "deepseek":
      return deepseekConstraint(isReadOnly);
    case "gemini":
      return GEMINI_CONSTRAINT;
    case "copilot":
      return copilotConstraint(isReadOnly);
    default:
      return "";
  }
}
