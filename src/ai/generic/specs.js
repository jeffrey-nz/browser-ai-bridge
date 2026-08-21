/**
 * Sites that need no bespoke provider — just their selectors.
 *
 * The five existing providers each own a directory of 330 to 4,277 lines, and
 * most of that is the same shape: type into the composer, click send, wait for
 * the answer to stop growing, read the last block. What actually differs
 * between sites is a handful of selectors. Five more hand-written directories
 * would have been ~1,650 lines of near-duplicate to keep in step with five
 * changing web apps.
 *
 * So: one implementation, parameterised. A site that outgrows it — a mode menu,
 * a thinking block to strip, an upsell modal that has to be dismissed by name —
 * graduates to its own directory, which is what chatgpt/gemini/copilot already
 * did. This is where a provider STARTS, not a cage.
 *
 * EVERY SELECTOR BELOW WAS READ OFF THE LIVE PAGE while signed in, on
 * 2026-08-18, not guessed. The survey that produced them is the same thing
 * `npm run audit` does when one breaks.
 */

/** Text has stopped growing for this many consecutive polls → the turn is done. */
export const DEFAULT_STABLE_POLLS = 3;

export const GENERIC_SPECS = {
  //[[ Kimi's composer is a contenteditable div, and its send control is a plain
  //   div with no role and no aria-label — so `clickOrFallbackToEnter` cannot find
  //   it by any accessible name and the class is the only handle there is.
  //
  //   MEASURED AND UNRESOLVED: on 2026-08-18 Kimi accepted a prompt, rendered the
  //   answer with its Copy/Share controls, then WITHDREW it and put the text back
  //   in the composer, showing "Too many people are chatting with Kimi right now.
  //   Subscribe to enter a dedicated priority queue!". That is a capacity refusal,
  //   not a selector fault, and it is why `rateLimit` matches that sentence: the
  //   bridge should fall through to another provider rather than sit in a queue.
  //   The send path here is therefore SELECTOR-VERIFIED BUT NOT TURN-VERIFIED. ]]
  kimi: {
    id: "kimi",
    name: "Kimi",
    url: "https://www.kimi.ai/?chat_enter_method=new_chat",
    urlMatch: (u) => u.includes("kimi.ai"),
    maxPromptChars: 100000,
    locators: {
      newChatBtn: "a.new-chat-btn",
      inputBox:
        ".chat-input-editor[contenteditable='true'], .chat-input-editor",
      sendBtn: ".send-button-container:not(.disabled)",
      stopBtn: "[class*='stop' i]",
      responseBlock: ".message-list > *",
      doneSignal: null,
    },
    // The composer placeholder says "Ask anything. Images work too.", but no
    // input[type=file] exists until the toolkit is opened; the shared uploader's
    // click-then-chooser strategy is the one that applies here.
    attachBtn: ".icon-button.toolkit-trigger-btn, input[type='file']",
    rateLimit: "Too many people are chatting with Kimi",
    dismiss: ["Got it", "Close"],
  },

  qwen: {
    id: "qwen",
    name: "Qwen",
    url: "https://chat.qwen.ai/",
    urlMatch: (u) => u.includes("qwen.ai"),
    maxPromptChars: 100000,
    locators: {
      newChatBtn: "a[href='/'], [class*='new-chat' i]",
      inputBox:
        "textarea.message-input-textarea, textarea[placeholder*='Ask Qwen' i]",
      sendBtn: ".message-input-right-button-send",
      stopBtn: "[class*='stop' i]",
      //[[ WRONG ABOUT WHICH SIDE "message"+"content" MATCHES (T-005). Qwen's
      //   own paragraph carries `user-message-content` — a class containing
      //   BOTH "message" and "content" on the QUESTION, not the answer. The
      //   assistant's markdown spans already match the first alternative, but
      //   `.last()` over BOTH alternatives together doesn't guarantee DOM
      //   order puts an assistant element after the user's, and for a fast
      //   short answer the user's bubble alone can be the only thing
      //   rendered when the completion poll's stability check runs, giving a
      //   verbatim echo of the prompt. The assistant's own class is
      //   `response-message-content` — excluding anything with "user" in its
      //   class keeps the second alternative's intent (a message/content
      //   block) while dropping the one turn it was never meant to match.
      //   Verified live: chat.qwen.ai, T-005 hand-back. ]]
      responseBlock:
        "[class*='markdown' i], [class*='message' i][class*='content' i]:not([class*='user' i])",
      doneSignal: null,
    },
    attachBtn: "input[type='file']",
    rateLimit: null,
    dismiss: [],
  },

  zai: {
    id: "zai",
    name: "Z.ai (GLM)",
    url: "https://chat.z.ai/",
    urlMatch: (u) => u.includes("z.ai"),
    maxPromptChars: 100000,
    //[[ The cleanest of the five: a textarea with a stable id, a send button with
    //   a real class, and a file input that names .png/.jpg in its accept list —
    //   so image work needs no click-through-to-chooser dance. ]]
    locators: {
      newChatBtn: "a[href='/'], button:has-text('New Chat')",
      inputBox: "textarea#chat-input",
      sendBtn: "button.sendMessageButton",
      stopBtn: "button[class*='stop' i]",
      responseBlock: "[class*='markdown' i], [class*='prose' i]",
      doneSignal: null,
    },
    attachBtn: "input[type='file']",
    rateLimit: null,
    dismiss: [],
    //[[ GLM prefixes its answer with a collapsed reasoning block that renders as
    //   the literal words "Thought Process". Left in, every answer arrives as
    //   "Thought Process <answer>" and anything parsing a one-word reply breaks. ]]
    stripPrefix: /^Thought Process\s*/i,
  },

  //[[ Mistral and Perplexity expose no send button until the composer has text,
  //   so `sendBtn` is a best-effort and Enter is the real path. clickOrFallbackToEnter
  //   already prefers the button and falls back, which is exactly this case. ]]
  mistral: {
    id: "mistral",
    name: "Mistral Le Chat",
    url: "https://chat.mistral.ai/chat",
    urlMatch: (u) => u.includes("mistral.ai"),
    maxPromptChars: 100000,
    locators: {
      newChatBtn: "a[href='/chat'], button:has-text('New Chat')",
      inputBox: "div.ProseMirror[contenteditable='true'], div.ProseMirror",
      sendBtn: "button[type='submit'], button[aria-label*='send' i]",
      stopBtn: "button[aria-label*='stop' i]",
      //[[ Mistral styles with Tailwind utilities and no semantic class, so there
      //   is nothing like ".markdown" to match. Each turn is a [class*="group/message"]
      //   and the USER's bubble is the one carrying ms-auto (right-aligned) on an
      //   inner div. My first attempt matched "prose" and "markdown", found
      //   neither, and the poll waited on empty text for five minutes while the
      //   answer sat on screen.
      //
      //   WRONG ABOUT WHAT ".last()" WOULD DO (T-005). The user's turn is the
      //   ONLY [class*="group/message"] element that exists for the first few
      //   seconds of a turn — Mistral does not create the assistant's own
      //   group/message wrapper until its reply actually starts streaming. With
      //   the plain selector, `.last()` on a one-element list IS the user's
      //   bubble, its text never changes, and the stability poll below saw a
      //   constant non-empty length from its very first read — "done" fired
      //   before Mistral had rendered a single token of an answer, extracting
      //   the prompt (or, once stripSuffix stripped it to nothing and the
      //   never-empty guard restored the original, a bare timestamp) instead.
      //   Excluding the ms-auto branch means the selector matches NOTHING
      //   until the assistant's own bubble exists, so the poll's `len > 0`
      //   check correctly keeps waiting instead of stabilizing on the wrong
      //   element. Verified live: chat.mistral.ai/chat, T-005 hand-back. ]]
      responseBlock: "[class*='group/message']:not(:has([class*='ms-auto']))",
      doneSignal: null,
    },
    attachBtn: "input[type='file']",
    rateLimit: null,
    dismiss: [],
    //[[ The message group carries the turn timestamp and the feedback row, so a
    //   one-word reply came back as "ready 2:24am Was this helpful? Skip". ]]
    stripSuffix: /\s*\d{1,2}:\d{2}\s*(?:am|pm)\b[\s\S]*$/i,
  },

  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    url: "https://www.perplexity.ai/",
    urlMatch: (u) => u.includes("perplexity.ai"),
    maxPromptChars: 100000,
    locators: {
      newChatBtn: "a[href='/'], button[aria-label*='new' i]",
      inputBox:
        "div#ask-input[contenteditable='true'], div#ask-input, textarea#ask-input",
      sendBtn:
        "button[aria-label*='submit' i], button[data-testid*='submit' i]",
      stopBtn: "button[aria-label*='stop' i]",
      responseBlock: "[class*='prose' i], [class*='markdown' i]",
      doneSignal: null,
    },
    attachBtn: "input[type='file']",
    rateLimit: null,
    dismiss: [],
  },
};

export const GENERIC_IDS = Object.keys(GENERIC_SPECS);
