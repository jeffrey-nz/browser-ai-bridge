import { CHATGPT_LOCATORS } from "#ai/chatgpt/locators.js";
import { GEMINI_LOCATORS } from "#ai/gemini/locators.js";
import { DEEPSEEK_LOCATORS } from "#ai/deepseek/locators.js";
import { GROK_LOCATORS } from "#ai/grok/locators.js";
import { COPILOT_LOCATORS } from "#ai/copilot/client/locators.js";
import { GENERIC_SPECS } from "#ai/generic/specs.js";
import { stepGeminiModelDropdown } from "./steps/geminiModelDropdown.js";
import { stepDeepSeekModeToggle } from "./steps/deepseekModeToggle.js";

//[[ T-010: the five generic providers (kimi, qwen, zai, mistral, perplexity —
//   src/ai/generic/specs.js) had no audit entry at all, and three separate
//   tickets (T-005, T-006, T-008) each had to diagnose a generic provider's
//   break by hand because nothing pointed at it first.
//
//   NO SECOND SHAPE NEEDED. Every audit step (contextReset, inputInjection,
//   submission, generationPolling, dataExtraction — motion.js) reads
//   locs.newChatBtn / .inputBox / .sendBtn / .stopBtn / .doneSignal /
//   .responseBlock / .responseText, all optional-guarded except inputBox/
//   sendBtn/stopBtn/responseBlock (T-013 correction: .responseText is a
//   seventh field, read at dataExtraction.js:6 and generationPolling.js:84 —
//   optional and unset by every provider, bespoke or generic, today; listed
//   here so this comment does not read as exhaustive when it is not).
//   GENERIC_SPECS[id].locators already carries the six field names the audit
//   actually exercises — it was written independently of this file and
//   happens to match, because both were describing the same five motions.
//   So a generic provider's spec.locators plugs directly into this array's
//   existing {name, url, locators, locatorsPath, locatorsExport} shape; nothing here
//   needed to grow a variant. (Two bespoke-provider fields, conversationTurn
//   and errorAlert, are unused by every current audit step — they are not
//   part of the shape this audit actually needs, generic or bespoke.)
//
//   WHAT THIS DOES NOT COVER, said plainly rather than left implicit. T-005's
//   fault was mistral's and qwen's dataExtraction step reading the WRONG
//   element — a selector that matched something real (the user's own turn),
//   not a selector matching nothing. stepDataExtraction (./steps/
//   dataExtraction.js) asserts extracted text is non-empty; it has no truth
//   value to compare against and cannot tell a right answer from a
//   plausible wrong one, on a generic provider or a bespoke one. This audit
//   answers "does the motion still work at all", not "did the correct DOM
//   node answer" — that second question is what T-005 needed and what
//   scripts/dom-diagnose.mjs + scripts/extraction-break-demo.mjs (T-005)
//   exist to answer, by inspecting the live page rather than asserting
//   non-emptiness.
//
//   PERPLEXITY IS ENTERED HERE WITH THE SAME CORRECT SELECTORS T-008
//   VERIFIED BY HAND — the DOM is not what's wrong (see T-008). Its own
//   motion test is expected to fail or hang far more often than the other
//   four (T-008 measured roughly 1 completed turn in 10): a ❌ from this
//   entry usually means "perplexity's composer DOM-swap race again", not
//   "a locator string needs updating". Kept in rather than left out, because
//   an audit that silently excludes a known-flaky provider is exactly the
//   kind of gap this ticket exists to close — but read a perplexity FAIL
//   against T-008 before touching its locators.js entry. ]]
//[[ T-013: `locatorsExport: "GENERIC_SPECS.kimi.locators"` below is not a
//   legal export name — it names a PATH INTO a shared file that holds all
//   five generic providers plus non-locator fields (id/url/urlMatch/
//   maxPromptChars/attachBtn/rateLimit/dismiss/stripSuffix), not a standalone
//   module export the way CHATGPT_LOCATORS etc. are. src/audit/fix/
//   generator.js used to hand an LLM "export a JS object EXACTLY named
//   `GENERIC_SPECS.kimi.locators`" — which cannot be written as valid JS —
//   and "here is the file to edit" pointing at specs.js with no warning that
//   the file holds four OTHER providers a naive full-file rewrite would drop.
//   `locatorsShape: "generic-entry"` plus `locatorsEntryId` tell the
//   generator to ask for just the one entry's locators object instead of an
//   export statement, and to say explicitly what not to touch. Chose a shape
//   flag on the provider entry over a second generator function or a
//   per-provider prompt template, because the only thing that differs is
//   WHAT to ask for and WHAT to warn against, not how the surrounding report/
//   HTML/instructions are assembled — a flag branches four lines of prompt
//   text; a second function would duplicate the other ~30. ]]
const generic = (id) => ({
  name: GENERIC_SPECS[id].name,
  url: GENERIC_SPECS[id].url,
  locators: GENERIC_SPECS[id].locators,
  locatorsPath: "src/ai/generic/specs.js",
  locatorsExport: `GENERIC_SPECS.${id}.locators`,
  locatorsShape: "generic-entry",
  locatorsEntryId: id,
});

export const AUDIT_PROVIDERS = [
  {
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    locators: CHATGPT_LOCATORS,
    locatorsPath: "src/ai/chatgpt/locators.js",
    locatorsExport: "CHATGPT_LOCATORS",
  },
  {
    name: "Gemini",
    url: "https://gemini.google.com/app",
    locators: GEMINI_LOCATORS,
    locatorsPath: "src/ai/gemini/locators.js",
    locatorsExport: "GEMINI_LOCATORS",
    extraSteps: [
      {
        name: "6. Model Dropdown (Pro / Thinking / Fast Selection)",
        fn: stepGeminiModelDropdown,
        optional: true,
      },
    ],
  },
  {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    locators: DEEPSEEK_LOCATORS,
    locatorsPath: "src/ai/deepseek/locators.js",
    locatorsExport: "DEEPSEEK_LOCATORS",
    extraSteps: [
      {
        name: "6. Mode Toggles (Fast / Expert DeepThink Selection)",
        fn: (page) => stepDeepSeekModeToggle(page),
        optional: true,
      },
    ],
  },
  {
    name: "Grok",
    url: "https://grok.com/",
    locators: GROK_LOCATORS,
    locatorsPath: "src/ai/grok/locators.js",
    locatorsExport: "GROK_LOCATORS",
  },
  {
    name: "Copilot (Personal)",
    url: "https://copilot.microsoft.com/",
    locators: COPILOT_LOCATORS,
    locatorsPath: "src/ai/copilot/client/locators.js",
    locatorsExport: "COPILOT_LOCATORS",
  },
  generic("kimi"),
  generic("qwen"),
  generic("zai"),
  generic("mistral"),
  generic("perplexity"),
];
