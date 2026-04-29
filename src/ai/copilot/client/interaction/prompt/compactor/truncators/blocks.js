const TAG_NAMES = [
  "file",
  "window",
  "bash_result",
  "search_results",
  "grep_results",
  "find_results",
  "phpunit_result",
  "composer_result",
  "sake_result",
  "http_result",
  "database_result",
  "lint_result",
];

const TAG_REGEXES = TAG_NAMES.map((tagName) => ({
  tagName,
  regex: new RegExp(`(<${tagName}[^>]*>)([\\s\\S]*?)(<\\/${tagName}>)`, "gi"),
}));

export function truncateBlocks(text, maxLength) {
  let compacted = text;

  for (const { tagName, regex } of TAG_REGEXES) {
    compacted = compacted.replace(regex, (match, open, content, close) => {
      if (content.length > maxLength) {
        return (
          `${open}\n` +
          `${content.slice(0, maxLength)}\n` +
          `... [${tagName.toUpperCase()} TRUNCATED TO FIT LIMIT. USE TOOLS TO EXPLORE FURTHER] ...\n` +
          `${close}`
        );
      }
      return match;
    });
  }

  return compacted;
}
