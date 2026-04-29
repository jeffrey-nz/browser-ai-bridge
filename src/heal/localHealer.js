import { logger } from "#utils/logger.js";

/**
 * Suggests updated locators using local heuristics instead of external AI APIs.
 *
 * @param {Object} params
 * @param {Object} params.providerContext - Provider context (name, url, exportName, filePath, description)
 * @param {string} params.currentLocators - Current locators file content as string
 * @param {string} params.htmlSnippet - Truncated HTML from the page
 * @param {string} params.screenshotBase64 - Ignored (not used)
 * @returns {Promise<string>} - Markdown code block with the updated locator export
 */
export async function suggestSelectorsLocally({ providerContext, currentLocators, htmlSnippet, screenshotBase64 }) {
  logger.info(`[LocalHealer] Suggesting selectors for ${providerContext.name} using local heuristics`);

  try {
    // Parse current locators to preserve unchanged keys
    const currentExport = parseCurrentExport(currentLocators, providerContext.exportName);
    if (!currentExport) {
      logger.warn(`[LocalHealer] Could not parse current locators for ${providerContext.name}, returning original`);
      return currentLocators;
    }

    // Extract improved selectors from HTML snippet
    const improvedSelectors = extractSelectorsFromHtml(htmlSnippet);

    // Merge: only update stopBtn and responseBlock if improved versions found
    const merged = { ...currentExport };
    if (improvedSelectors.stopBtn) merged.stopBtn = improvedSelectors.stopBtn;
    if (improvedSelectors.responseBlock) merged.responseBlock = improvedSelectors.responseBlock;

    // Build the output code block
    const codeBlock = buildCodeBlock(merged, providerContext);

    logger.info(`[LocalHealer] Generated updated locators for ${providerContext.name}`);
    return codeBlock;
  } catch (err) {
    logger.error(`[LocalHealer] Error: ${err.message}`);
    return currentLocators;
  }
}

/**
 * Parse the current locators file to extract the export object.
 * @param {string} currentLocators
 * @param {string} exportName
 * @returns {Object|null}
 */
function parseCurrentExport(currentLocators, exportName) {
  try {
    // Extract the object literal between export const EXPORT_NAME = { ... };
    const regex = new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*({[\\s\\S]*?});`, 'i');
    const match = currentLocators.match(regex);
    if (!match) return null;
    // Use Function to safely evaluate the object (trusted source)
    const obj = new Function(`return (${match[1]})`)();
    return obj;
  } catch (err) {
    logger.warn(`[LocalHealer] Parse error: ${err.message}`);
    return null;
  }
}

/**
 * Extract improved selectors from HTML snippet using regex heuristics.
 * @param {string} html
 * @returns {{stopBtn?: string, responseBlock?: string}}
 */
function extractSelectorsFromHtml(html) {
  const result = {};

  // Find stop button (disappears when generation completes)
  // Priority: button with aria-label containing "stop" or class containing "stop-generating"
  const stopBtnPatterns = [
    /<button[^>]*aria-label="[^"]*[Ss]top[^"]*"[^>]*>/,
    /<button[^>]*class="[^"]*stop-generating[^"]*"[^>]*>/,
    /<button[^>]*>[\s]*[Ss]top[\s]*<\/button>/,
    /<div[^>]*role="button"[^>]*>[\s]*[Ss]top[\s]*<\/div>/,
  ];
  for (const pattern of stopBtnPatterns) {
    if (pattern.test(html)) {
      // Try to find a good selector: look for id, data-testid, or a stable class
      const idMatch = html.match(/id="([^"]+)"/);
      if (idMatch) {
        result.stopBtn = `#${idMatch[1]}`;
        break;
      }
      const testIdMatch = html.match(/data-testid="([^"]+)"/);
      if (testIdMatch) {
        result.stopBtn = `[data-testid="${testIdMatch[1]}"]`;
        break;
      }
      // Fallback to class-based
      result.stopBtn = "button[class*='stop']";
      break;
    }
  }

  // Find response block (element containing AI response text)
  const responsePatterns = [
    /<div[^>]*class="[^"]*markdown[^"]*"[^>]*>/,
    /<div[^>]*class="[^"]*response[^"]*"[^>]*>/,
    /<div[^>]*class="[^"]*message[^"]*"[^>]*>/,
    /<div[^>]*class="[^"]*assistant[^"]*"[^>]*>/,
  ];
  for (const pattern of responsePatterns) {
    if (pattern.test(html)) {
      const idMatch = html.match(/id="([^"]+)"/);
      if (idMatch) {
        result.responseBlock = `#${idMatch[1]}`;
        break;
      }
      const testIdMatch = html.match(/data-testid="([^"]+)"/);
      if (testIdMatch) {
        result.responseBlock = `[data-testid="${testIdMatch[1]}"]`;
        break;
      }
      result.responseBlock = ".ds-markdown, .markdown-content";
      break;
    }
  }

  return result;
}

/**
 * Build the final markdown code block with the updated locator export.
 * @param {Object} locatorObject
 * @param {Object} providerContext
 * @returns {string}
 */
function buildCodeBlock(locatorObject, providerContext) {
  const lines = [];
  lines.push(`// relative path: ${providerContext.filePath}`);
  lines.push(`export const ${providerContext.exportName} = {`);
  for (const [key, value] of Object.entries(locatorObject)) {
    lines.push(`  ${key}: "${value}",`);
  }
  lines.push(`};`);
  const code = lines.join('\n');
  return `\`\`\`javascript\n${code}\n\`\`\``;
}
