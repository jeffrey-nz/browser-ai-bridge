import { logger } from "./logger.js";

/**
 * Attempts to repair JSON that contains unescaped double quotes or raw control
 * characters inside string values — common DeepSeek output issues when file
 * content includes code with string literals (e.g., C#: new GameObject("name"))
 * or when the model emits real newlines instead of \n escape sequences.
 *
 * Quote heuristic: a `"` inside a string is treated as an inner (unescaped)
 * quote unless the next non-whitespace character is a JSON structural token
 * (`,` `}` `]` `:`), in which case it closes the string.
 *
 * Control character handling: real newlines (LF/CR) and tabs inside strings
 * are escaped to their JSON equivalents (\n, \r, \t).
 */
function repairUnescapedQuotes(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
        continue;
      }

      // Peek ahead past whitespace to find the next structural character.
      let j = i + 1;
      while (j < text.length && /[ \t\r\n]/.test(text[j])) j++;
      const next = j < text.length ? text[j] : "";

      if (
        next === "" ||
        next === "," ||
        next === "}" ||
        next === "]" ||
        next === ":"
      ) {
        // This quote closes the current string value.
        inString = false;
        result += ch;
      } else {
        // This is an unescaped inner quote — escape it.
        result += '\\"';
      }
      continue;
    }

    // Inside a string, escape raw control characters that JSON forbids.
    if (inString) {
      if (code === 0x0a) {
        result += "\\n";
        continue;
      } // LF
      if (code === 0x0d) {
        result += "\\r";
        continue;
      } // CR
      if (code === 0x09) {
        result += "\\t";
        continue;
      } // TAB
    }

    result += ch;
  }

  return result;
}

function tryParseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    logger.debug(
      `[responseParser] ${label}: initial parse failed — ${e.message}`,
    );
  }

  // Second attempt: repair unescaped quotes / raw control chars then retry.
  try {
    const repaired = repairUnescapedQuotes(raw);
    const parsed = JSON.parse(repaired);
    logger.debug(`[responseParser] ${label}: parsed after repair.`);
    return parsed;
  } catch (e2) {
    logger.debug(
      `[responseParser] ${label}: repair+parse also failed — ${e2.message}`,
    );
  }

  return null;
}

export function extractStructuredData(text) {
  if (!text || typeof text !== "string") return null;

  const jsonBlocks = [];

  const parts = text.split("```");

  for (let i = 1; i < parts.length; i += 2) {
    let blockContent = parts[i].trim();

    if (blockContent.toLowerCase().startsWith("json")) {
      blockContent = blockContent.substring(4).trim();
    }

    const parsed = tryParseJson(blockContent, "markdown code block");
    if (parsed !== null) jsonBlocks.push(parsed);
  }

  if (jsonBlocks.length === 0) {
    const trimmed = text.trim();

    // Scan every [ and { position as a candidate start of JSON.
    // Tries each in order and stops at the first successful parse.
    // This handles: pure JSON, JSON with a reasoning/think prefix, and JSON
    // with trailing text — without requiring startsWith/endsWith heuristics.
    outer: for (const marker of ["[", "{"]) {
      let pos = trimmed.indexOf(marker);
      while (pos !== -1) {
        const candidate = trimmed.slice(pos);
        const parsed = tryParseJson(
          candidate,
          `raw JSON at '${marker}' pos ${pos}`,
        );
        if (parsed !== null) {
          jsonBlocks.push(parsed);
          break outer;
        }
        pos = trimmed.indexOf(marker, pos + 1);
      }
    }
  }

  if (jsonBlocks.length === 0) return null;

  return jsonBlocks.length === 1 ? jsonBlocks[0] : jsonBlocks;
}

/**
 * Like extractStructuredData but also returns a normalizedText — a clean
 * JSON string that the calling system's simple JSON.parse can handle directly.
 *
 * If the original text already contains parseable JSON at the bracket positions
 * the calling system would find, normalizedText is the original text unchanged.
 * If repair was required (or the JSON was buried in a code block / after a
 * reasoning prefix), normalizedText is JSON.stringify(data) — a clean array.
 *
 * This lets the API return normalizedText as the response body so the calling
 * system's parseToolCalls never hits a parse error even when DeepSeek emits
 * malformed JSON.
 */
export function extractAndNormalize(text) {
  const data = extractStructuredData(text);
  if (data === null) return { data: null, normalizedText: text };

  // Check whether the calling system's own naive extraction (indexOf "[" … "]")
  // would already succeed on the raw text — if so, no rewrite needed.
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1) {
    try {
      JSON.parse(text.substring(firstBracket, lastBracket + 1));
      return { data, normalizedText: text };
    } catch {
      // fall through — repair was needed
    }
  }

  // Repair was used (or JSON was inside a code block / prefixed by reasoning).
  // Produce a clean, flat JSON array string.
  const asArray = Array.isArray(data) ? data : [data];
  return { data, normalizedText: JSON.stringify(asArray) };
}
