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
  const result = await lastTurn
    .locator(".markdown")
    .evaluate((el) => {
      if (!el) return "";
      let out = "";
      const blockTags = new Set([
        "p",
        "div",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "ol",
        "ul",
        "table",
        "tr",
        "br",
        "hr",
      ]);
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
          const raw = codeEl.innerText || codeEl.textContent || "";
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
    })
    .catch(() => "");
  return (result || "").trim();
}

// Python dunder names. ChatGPT's Copy-button markdown serializer treats the
// source token __init__ as bold (markdown: __x__ ≡ **x**) and emits it back as
// **init**, which is a SyntaxError in Python. Restore the double-underscore form
// for the known dunder set — narrow enough to never touch real ** operators
// (exponent, *args/**kwargs) since those are not __word__ in the source.
const PY_DUNDERS = [
  "init",
  "name",
  "main",
  "str",
  "repr",
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "hash",
  "call",
  "iter",
  "next",
  "len",
  "getitem",
  "setitem",
  "delitem",
  "contains",
  "enter",
  "exit",
  "dict",
  "doc",
  "file",
  "all",
  "module",
  "class",
  "bool",
  "add",
  "sub",
  "mul",
  "truediv",
  "floordiv",
  "mod",
  "pow",
  "new",
  "del",
  "format",
  "sizeof",
  "index",
  "slots",
  "abs",
  "neg",
  "pos",
  "round",
  "int",
  "float",
  "bytes",
  "dir",
  "getattr",
  "setattr",
  "delattr",
  "getattribute",
  "reversed",
  "post_init",
  "init_subclass",
  "set_name",
];
const DUNDER_RE = new RegExp(`\\*\\*(${PY_DUNDERS.join("|")})\\*\\*`, "g");

function restoreDunders(text) {
  if (!text) return text;
  return text.replace(DUNDER_RE, "__$1__");
}

/**
 * Extract the response via ChatGPT's own "Copy" button.
 *
 * This is the ONLY fully reliable method: the copy button runs ChatGPT's
 * internal serializer which reconstructs the EXACT markdown source the model
 * produced — every space of indentation, every blank line, every code fence.
 * Scraping the rendered DOM cannot recover indentation that markdown's
 * 4-space-indented-code-block rule consumed, so the copy button is preferred.
 *
 * Returns the clipboard text, or "" if the copy button can't be found/clicked.
 */
async function extractViaCopyButton(page, lastTurn) {
  const tag = "[chatgpt-extract]";
  try {
    // Clipboard read requires the page to be the focused/foreground tab.
    await page.bringToFront().catch(() => {});
    // The action bar (with the Copy button) only renders on hover for some
    // ChatGPT versions — hover the turn first to force it into the DOM.
    await lastTurn.hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);

    // ONLY the per-message copy button — never a per-code-block copy button
    // (those copy a single block, not the whole response).
    const copySelectors = [
      '[data-testid="copy-turn-action-button"]',
      'button[aria-label="Copy"]:not([data-testid*="code"])',
      'button[aria-label="Copy message"]',
    ];
    let clicked = false;
    for (const sel of copySelectors) {
      const btn = lastTurn.locator(sel).last();
      const n = await btn.count().catch(() => 0);
      if (n > 0) {
        const ok = await btn
          .click({ timeout: 2500 })
          .then(() => true)
          .catch(() => false);
        if (ok) {
          clicked = true;
          console.log(`${tag} copy button clicked via "${sel}"`);
          break;
        }
      }
    }
    if (!clicked) {
      console.log(`${tag} no copy button found — falling back to DOM walk`);
      return "";
    }
    // Give ChatGPT's clipboard write a moment to land, then read it back.
    await page.waitForTimeout(250);
    const text = await page
      .evaluate(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch (e) {
          return "__CLIP_ERR__" + (e?.message || "unknown");
        }
      })
      .catch(() => "");
    if (typeof text === "string" && text.startsWith("__CLIP_ERR__")) {
      console.log(
        `${tag} clipboard read failed: ${text.slice(12)} — falling back to DOM walk`,
      );
      return "";
    }
    const trimmed = (text || "").trim();
    console.log(`${tag} clipboard extraction: ${trimmed.length} chars`);
    return trimmed;
  } catch (e) {
    console.log(
      `${tag} copy-button extraction threw: ${e?.message || e} — falling back`,
    );
    return "";
  }
}

export async function extractChatGptResponse(page) {
  const lastTurn = page.locator('[data-testid^="conversation-turn-"]').last();

  // Primary: ChatGPT's Copy button → raw markdown via clipboard. Exact source,
  // immune to the markdown-renderer indentation loss that breaks DOM scraping.
  // restoreDunders undoes the __x__→**x** bold round-trip in the serializer.
  const copyText = await extractViaCopyButton(page, lastTurn);
  if (copyText && copyText.length > 10)
    return restoreDunders(cleanAiResponse(copyText));

  // Secondary: .markdown DOM walk — use textContent/innerText hybrid so that
  // multi-space indentation is preserved as far as the rendered DOM allows.
  const codeAwareText = await extractMarkdownPreservingCode(page, lastTurn);
  if (codeAwareText && codeAwareText.length > 10)
    return cleanAiResponse(codeAwareText);

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
