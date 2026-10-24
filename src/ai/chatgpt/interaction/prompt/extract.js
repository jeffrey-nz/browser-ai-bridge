import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";
import { CHATGPT_DOM } from "../../locators.js";
import { readChatGptConversationApi, stripCitationMarkup } from "./dom.js";

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
async function extractMarkdownPreservingCode(page, assistantMessage) {
  // Walk the .markdown DOM and assemble text manually. For <code> children of
  // <pre> we use textContent (preserves indentation). For everything else we
  // re-introduce newlines at block boundaries so the result resembles the
  // original markdown source. Pure innerText collapses leading whitespace on
  // every line of ChatGPT-rendered code; pure textContent drops paragraph
  // breaks. This hybrid keeps both.
  const result = await assistantMessage
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
    }, undefined, { timeout: 3000 })
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
    // NOT "Copy message": since 2026-10-25 that is the user bubble's button.
    const copySelectors = CHATGPT_DOM.copy;
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

//[[ FOUR READS, NEWEST-PROOF FIRST, AND SILENCE IS AN ERROR.
//
//   1. The reply the poller already took from the conversation API because the
//      DOM could not see it (page.__chatgptApiReply).
//   2. The conversation API: the exact markdown the model wrote, read from the
//      page's own backend. It needs no selector, no focus and no clipboard, so a
//      re-skin cannot break it, and it does not pull the bridge's tab to the
//      front of a Chrome that other sessions are using. Accepted only when the
//      message is NEW (not the reply that was there before the send) and
//      finished. Not passed through cleanAiResponse, which strips UI chrome such
//      as "Copy code" — and also any "edit\n" — from rendered text.
//   3. The Copy button of the last assistant turn → clipboard (ChatGPT's own
//      markdown serializer). Scoped to the assistant half: since 2026-10-25
//      "Copy message" is the USER bubble's button.
//   4. A walk of the last assistant message's DOM.
//   Nothing from any of them is "provider DOM changed", not an empty answer the
//   caller has to guess about. ]]
export async function extractChatGptResponse(page) {
  if (page.__chatgptApiReply) {
    const t = stripCitationMarkup(page.__chatgptApiReply);
    delete page.__chatgptApiReply;
    if (t) return t;
  }

  const baseline = page.__chatgptBaseline || {};
  const api = await readChatGptConversationApi(page);
  if (
    api.ok &&
    api.id &&
    api.id !== baseline.apiReplyId &&
    api.status === "finished_successfully" &&
    api.text?.trim()
  ) {
    return stripCitationMarkup(api.text);
  }

  const assistantSel = CHATGPT_DOM.assistant.join(", ");
  const lastAssistant = page.locator(assistantSel).last();
  const hasAssistant = (await page.locator(assistantSel).count().catch(() => 0)) > 0;

  if (hasAssistant) {
    // The turn container holding the last reply, for its Copy button.
    const lastTurn = page
      .locator(CHATGPT_DOM.turn.join(", "))
      .filter({ has: page.locator(assistantSel) })
      .last();
    const copyText = await extractViaCopyButton(page, lastTurn);
    if (copyText && copyText.length > 10)
      return restoreDunders(cleanAiResponse(copyText));

    const codeAwareText = await extractMarkdownPreservingCode(page, lastAssistant);
    if (codeAwareText) return cleanAiResponse(codeAwareText);

    const rawText = await lastAssistant
      .innerText({ timeout: 2000 })
      .catch(() => "");
    if (rawText.trim()) return cleanAiResponse(rawText);
  }

  // Canvas/artifact panel — ChatGPT may render code in a side panel when the
  // response is large or code-heavy (canvas mode).
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
      .innerText({ timeout: 1000 })
      .catch(() => "");
    if (canvasText && canvasText.trim().length > 10)
      return cleanAiResponse(canvasText);
  }

  // A short reply the API has but has not marked finished yet, rather than none.
  if (api.ok && api.id && api.id !== baseline.apiReplyId && api.text?.trim()) {
    return stripCitationMarkup(api.text);
  }

  const err = new Error(
    `provider DOM changed: assistant reply (none of: ${CHATGPT_DOM.assistant.join(" | ")}) and the conversation API gave nothing (${api.ok ? "no new reply" : api.why}) — update src/ai/chatgpt/locators.js`,
  );
  err.domChanged = true;
  throw err;
}
