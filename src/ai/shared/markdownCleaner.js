export function cleanAiResponse(text) {
  if (!text) return "";

  return text
    .replace(/^Copy( code)?\s*(?:\n|$)/gim, "")
    .replace(/\bCopy\b[ \t]*\n/g, "")
    .replace(/json Copy/gi, "")
    .replace(/^Download\s*\n/gim, "")
    .replace(/expand_more\n/g, "")
    .replace(/edit\n/g, "")
    .replace(/^(JSON|XML|Markdown|Response|Output|Code)[:\s]*/gim, "")
    .replace(/(\n|^)Thought\n/gi, "\n<thought>\n")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}
