export function compactToolList(text) {
  const startMarker = "## 🛠 AVAILABLE JSON TOOLS\n";
  const endMarker = "\n\n## ";
  const start = text.indexOf(startMarker);

  if (start !== -1) {
    const end = text.indexOf(endMarker, start + startMarker.length);
    if (end !== -1) {
      const compactTools =
        startMarker +
        "Tools: read_file, write_file, patch_file, list_dir, delete_file, move_file, search_codebase, grep, execute_bash, query_database, http_request, workflow_complete";

      return text.slice(0, start) + compactTools + text.slice(end);
    }
  }
  return text;
}
