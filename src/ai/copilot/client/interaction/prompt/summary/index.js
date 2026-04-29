import { extractSummary, isPureToolCalls, extractTagsText } from "./parser.js";
import { printSummaryBox, printRawSnippet, printTagsBox } from "./printer.js";

export function printResponseSummary(text) {
  if (!text) return;

  const aiSummary = extractSummary(text);

  if (aiSummary) {
    printSummaryBox(aiSummary);
  } else if (!isPureToolCalls(text)) {
    printRawSnippet(text);
  }

  const tagLines = extractTagsText(text);
  if (tagLines.length > 0) {
    printTagsBox(tagLines);
  }
}
