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
  //   MEASURED AND UNRESOLVED (2026-08-18): Kimi accepted a prompt, rendered the
  //   answer with its Copy/Share controls, then WITHDREW it and put the text back
  //   in the composer, showing "Too many people are chatting with Kimi right now.
  //   Subscribe to enter a dedicated priority queue!". That is a capacity refusal,
  //   not a selector fault, and it is why `rateLimit` matches that sentence: the
  //   bridge should fall through to another provider rather than sit in a queue.
  //
  //   T-006: THE REAL FAULT WAS responseBlock, AND IT WAS A REDESIGN, NOT THE
  //   RATE LIMIT. Kimi's site was rebuilt since the note above was written —
  //   `.message-list` does not exist anywhere in the current DOM (0 matches,
  //   confirmed live), so readAnswer() always returned "", the completion
  //   poll's `len > 0` check never passed, and every turn ran out the full
  //   300s poll timeout regardless of whether the model had already answered.
  //   It had: live-verified turns show the answer rendered and complete
  //   ("PONG", with its Copy/regenerate/Share/thumbs row) while the bridge
  //   was still waiting. Same failure shape as T-005's mistral/qwen — a
  //   completion check with nothing to read — except here the selector
  //   matches NOTHING at all rather than the wrong element, so it was never
  //   going to intermittently work the way T-005's bug did.
  //
  //   Current structure: the assistant's final answer is a `.markdown-
  //   container` inside `.chat-content-item-assistant`; Kimi's own visible
  //   "Think" reasoning toggle renders as a SIBLING `.markdown-container`
  //   that additionally carries `.toolcall-content-text` — excluding that
  //   class is what keeps the reasoning block from being mistaken for the
  //   answer, the same shape as T-005's exclusions for mistral and qwen.
  //
  //   NOT FULLY RELIABLE EVEN WITH THE FIX (2026-08-21): the selector above
  //   is verified correct — it reads the right element when Kimi answers —
  //   but Kimi still does not complete every turn. 4 runs post-fix: 3
  //   completed in 28-38s each, 1 (run1, t006-kimi-run1.json) ran out the
  //   full 300s poll timeout with no answer, confirmed via bridge-server
  //   log timestamps to have happened AFTER this fix was already loaded,
  //   not before it. So: 3 of 4 (~75%), not "fixed" in the sense of
  //   reliably completing — the responseBlock bug is gone, but some other,
  //   undiagnosed cause still occasionally stalls the turn entirely. ]]
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
      responseBlock:
        "div.chat-content-item-assistant div.markdown-container:not(.toolcall-content-text)",
      doneSignal: null,
    },
    // The composer placeholder says "Ask anything. Images work too.", but no
    // input[type=file] exists until the toolkit is opened; the shared uploader's
    // click-then-chooser strategy is the one that applies here.
    //
    // T-030, LIVE-VERIFIED: opening the toolkit is only the FIRST click — it
    // reveals a `.toolkit-popover` menu ("Add files & photos", Plugins,
    // Skills, Web search), and no file input or chooser exists until the
    // "Add files & photos" item is ALSO clicked. That item is a
    // `<label class="toolkit-item">` wrapping the real hidden input, so
    // clicking it fires a native `filechooser` event directly — confirmed via
    // CDP against the live kimi.ai composer (attach-diagnose-style probe).
    attachBtn: ".icon-button.toolkit-trigger-btn, input[type='file']",
    attachMenuItem: "label.toolkit-item:has-text('Add files & photos')",
    //[[ T-031, LIVE-VERIFIED: an upload that errors client-side (a
    //   malformed/too-small file) leaves an `.image-thumbnail.error` node in
    //   `.chat-editor-attachment-area` that clicking "New Chat" (the SPA
    //   button, not a reload) does NOT clear — confirmed surviving three
    //   consecutive New Chat clicks in one live session, still matching
    //   DEFAULT_ATTACHMENT_EVIDENCE's `[class*="thumbnail" i]` and still
    //   satisfying waitForAttachmentEvidence() (verify()'s own call)
    //   afterwards. An unsent SUCCESS thumbnail left the same way (upload
    //   without sending) is just as sticky. Two independent defects, one
    //   fix each:
    //     1. SAME-TURN: a malformed upload's OWN error thumbnail satisfies
    //        the default evidence selector just as readily as a real one —
    //        attachEvidence narrows kimi to `.image-thumbnail.success`,
    //        which `.error` never carries.
    //     2. LATER-TURN: a stuck thumbnail (either state) surviving New
    //        Chat can satisfy THAT selector for a turn that never
    //        genuinely re-verified — requireGrowth (uploadFile.js) makes
    //        verify() require the match count to grow past what it already
    //        was when this call's own upload attempt started, so a stale
    //        leftover from an earlier turn can't stand in for this turn's
    //        own evidence. (Tried first: clicking the stuck thumbnail's own
    //        `.image-delete-icon` away in startNewChat. Abandoned — it
    //        isn't just CSS-hidden pre-hover, it doesn't mount in the DOM
    //        until its thumbnail is hovered, and automating that reliably
    //        through repeated live runs proved too flaky to stand behind;
    //        requireGrowth reaches the same guarantee without touching the
    //        page at all.) ]]
    attachEvidence: ".image-thumbnail.success",
    requireGrowth: true,
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
    //   so image work needs no click-through-to-chooser dance.
    //
    //   T-014, THEN REVERTED ON RE-CHECK. imageAttached was false on every
    //   recorded zai run, yet t006-zai-r2-run1.json is a PASS with the count and
    //   colour both correct — a real read reported as unconfirmed. First fix
    //   tried `.chip-scroll` (the class wrapping the composer's file-attachment
    //   card) as a per-provider verifySelector. WRONG: a negative control on a
    //   genuinely empty composer — a brand-new tab, nothing uploaded this turn —
    //   still found `.chip-scroll` present and visible, because zai persists
    //   UNSENT draft attachments against the account itself, across tabs, once a
    //   submission fails (the same "input did not clear and generation did not
    //   start" fault T-006 already documents leaves its half-sent image sitting
    //   in the composer rather than clearing it). A live check found three such
    //   stuck drafts, each a real `<img>`-bearing chip identical in shape to a
    //   genuine new upload, left over from this repo's own earlier test runs.
    //   `.chip-scroll` cannot tell "attached this turn" from "some earlier
    //   turn's upload never got dismissed", so it would have reported
    //   imageAttached:true on every future zai turn regardless of whether that
    //   turn's own upload worked — worse than the bug it was meant to fix.
    //   Reverted to the shared DEFAULT_ATTACHMENT_EVIDENCE (i.e. no
    //   attachEvidence override): zai is back to reporting imageAttached:false
    //   unconfirmed, same as before this ticket, which is the conservative,
    //   correct-when-uncertain answer. A real fix needs either a selector that
    //   can identify THIS turn's own chip specifically (nothing in the DOM
    //   distinguishes one chip from another) or zai's stuck-draft accumulation
    //   fixed at the source — both out of this ticket's scope. ]]
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
    //[[ T-030, LIVE-VERIFIED: the composer's leftmost "+" icon is a real
    //   button — misleadingly `aria-label="Open settings menu"`, not
    //   anything attach-shaped, which is why the generic button-guessing
    //   fallback in uploadFile.js never found it — that opens a dropdown
    //   ("Upload Files", Connectors, Tools, Projects, Libraries, Workflows,
    //   Agents). No input[type="file"] exists anywhere in the DOM until
    //   its "Upload Files" item is ALSO clicked; that click fires a native
    //   `filechooser` event directly. Confirmed via CDP against the live
    //   chat.mistral.ai composer. ]]
    attachBtn: "button[aria-label='Open settings menu']",
    attachMenuItem: "button:has-text('Upload Files')",
    //[[ T-030: DEFAULT_ATTACHMENT_EVIDENCE never matches here — the uploaded
    //   image renders as `<img src="data:image/...">`, not `blob:`, with no
    //   "attachment"/"thumbnail"/"preview"/"chip"/"file" class of its own.
    //   Its nearest distinguishing ancestor is `.group/zoomable-image`
    //   (Mistral's own hover-to-zoom wrapper). NEGATIVE CONTROL RUN, same
    //   standard T-014's zai revert set: on a fresh chat with nothing
    //   uploaded, `[class*="zoomable-image" i]` matches 0 elements — unlike
    //   zai's `.chip-scroll`, this does not persist a stuck draft across a
    //   reload. ]]
    attachEvidence: "[class*='zoomable-image' i]",
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
