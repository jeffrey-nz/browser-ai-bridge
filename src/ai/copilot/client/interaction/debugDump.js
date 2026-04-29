import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { forceCopyToClipboard } from "#tools/copyProjectToClipboard/clipboard.js";
import { extractDiagnostics } from "./debug/extractDiagnostics.js";
import { extractHtml } from "./debug/extractHtml.js";
import { formatDiagnostics } from "./debug/formatDump.js";

export async function renderDebugDump(page, errorMsg = "", label = "Stuck UI") {
  let url = "unknown";
  try {
    url = page.url();
  } catch {}

  const diag = await extractDiagnostics(page);
  const html = await extractHtml(page);
  const diagLines = formatDiagnostics(diag);

  const clipboardPayload = [
    `DEBUG DUMP — ${label}`,
    `Error : ${errorMsg}`,
    `URL   : ${url}`,
    "",
    "=== DIAGNOSTICS ===",
    ...diagLines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")),
    "",
    "=== COMPOSER HTML ===",
    "```html",
    html,
    "```",
  ].join("\n");

  let copyStatus = "";
  try {
    forceCopyToClipboard(clipboardPayload);
    copyStatus = colors.green(" ✔ copied to clipboard");
  } catch {
    copyStatus = colors.yellow(" ✘ clipboard copy failed");
  }

  const border = colors.dim("━".repeat(68));

  log(
    [
      "",
      border,
      `🐞  ${colors.bold(`DEBUG DUMP — ${label}`)}${copyStatus}`,
      border,
      `${colors.yellow("Error :")} ${errorMsg}`,
      `${colors.yellow("URL   :")} ${url}`,
      "",
      ...diagLines,
      "",
      colors.dim("────────── Composer HTML (for selector analysis) ──────────"),
      colors.dim("```html"),
      html,
      colors.dim("```"),
      border,
      "",
    ].join("\n"),
  );
}
