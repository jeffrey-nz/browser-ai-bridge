import { extractText } from "#ai/shared/domInteraction.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";

/**
 * Extract the markdown response using textContent on <pre><code> blocks.
 *
 * Why not innerText for the whole element?
 *   ChatGPT renders code blocks with a syntax-highlighter that wraps each token
 *   in a separate <span>. innerText() walks the rendered text and — depending on
 *   CSS white-space rules — sometimes collapses or omits the leading whitespace
 *   on each line. The symptom: Python files come back with single-space (or zero!)
 *   indentation, producing IndentationError on every paste.
 *
 *   textContent on the <pre> preserves the source whitespace exactly. We use it
 *   for code blocks and stitch the result back into the surrounding markdown.
 */
async function extractMarkdownPreservingCode(page, lastTurn) {
  // Walk the .markdown DOM and assemble text manually. For <code> children of
  // <pre> we use textContent (preserves indentation). For everything else we
  // re-introduce newlines at block boundaries so the result resembles the
  // original markdown source. Pure innerText collapses leading whitespace on
  // every line of ChatGPT-rendered code; pure textContent drops paragraph
  // breaks. This hybrid keeps both.
  const result = await lastTurn.locator(".markdown").evaluate((el) => {
    if (!el) return "";
    let out = "";
    const blockTags = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ol", "ul", "table", "tr", "br", "hr"]);
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue || "";
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName?.toLowerCase();
      // <pre> → use innerText. CSS `white-space: pre` on <pre> tells the browser
      // to preserve whitespace in the rendered text, so innerText (which respects
      // CSS) returns the indented source — whereas textContent (which ignores CSS)
      // returns whitespace-collapsed garbage for ChatGPT's syntax-highlighted code.
      //
      // We do NOT wrap with triple-backtick fences here. The downstream parser
      // captures everything between <<<FILE:>>> and <<<END FILE>>> as raw file
      // content; any inserted fences would end up written to disk and break the
      // resulting source file.
      if (tag === "pre") {
        const codeEl = node.querySelector("code") || node;
        const raw = (codeEl.innerText || codeEl.textContent || "");
        if (out && !out.endsWith("\n")) out += "\n";
        out += raw + (raw.endsWith("\n") ? "" : "\n");
        return;
      }
      // <br> → explicit newline
      if (tag === "br") {
        out += "\n";
        return;
      }
      // Inline <code> → preserve text without code-fence wrapping
      if (tag === "code") {
        out += node.textContent || "";
        return;
      }
      const isBlock = blockTags.has(tag);
      if (isBlock && out && !out.endsWith("\n")) out += "\n";
      for (const child of node.childNodes) walk(child);
      if (isBlock && !out.endsWith("\n")) out += "\n";
    };
    walk(el);
    return out;
  }).catch(() => "");
  return (result || "").trim();
}

export async function extractChatGptResponse(page) {
  const lastTurn = page.locator('[data-testid^="conversation-turn-"]').last();

  // Primary: .markdown div, but use textContent for <pre> code blocks so that
  // multi-space indentation (Python, YAML, indented JSON) is preserved.
  const codeAwareText = await extractMarkdownPreservingCode(page, lastTurn);
  if (codeAwareText && codeAwareText.length > 10) return cleanAiResponse(codeAwareText);

  // Fallback: original innerText path
  const rawText = await extractText(
    page,
    lastTurn.locator(".markdown"),
    null,
    [],
  );
  if (rawText) return cleanAiResponse(rawText);

  // Secondary: canvas/artifact panel — ChatGPT may render code in a side panel
  // when the response is large or code-heavy (canvas mode).
  const canvasSelectors = [
    '[data-testid="canvas-container"]',
    '[data-testid="artifact"]',
    ".artifact-content",
    "aside pre",
    "aside code",
  ];
  for (const sel of canvasSelectors) {
    const canvasText = await page
      .locator(sel)
      .last()
      .innerText()
      .catch(() => "");
    if (canvasText && canvasText.trim().length > 10)
      return cleanAiResponse(canvasText);
  }

  // Tertiary: assistant turn text, stripping tool-plan reasoning UI elements
  // that appear when ChatGPT uses its internal tool-use UI.
  const assistantTurn = page
    .locator('[data-message-author-role="assistant"]')
    .last();
  const assistantText = await assistantTurn.innerText().catch(() => "");
  if (assistantText) {
    // Strip <tool-plan>...</tool-plan> sections — these are ChatGPT's internal reasoning
    // UI, not the actual response. Without stripping, the parser sees only the plan and
    // no JSON tool calls, triggering spurious toolplan-recovery loops.
    const stripped = assistantText
      .replace(/<tool-plan>[\s\S]*?<\/tool-plan>/gi, "")
      .trim();
    if (stripped) return cleanAiResponse(stripped);
  }

  return "";
}
