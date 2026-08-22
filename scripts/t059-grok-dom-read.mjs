#!/usr/bin/env node
/**
 * t059-grok-dom-read.mjs — T-059. Settles, by an IN-WINDOW live DOM read
 * during a real grok turn (in the same regime T-054/T-072's echoing turns
 * ran in, not a fresh-chat steady-state snapshot), whether the ECHO shape
 * T-054 found is (i) the extractor reading OUR OWN user bubble because
 * `.last()` over a shared user+assistant selector picked it up before the
 * assistant's own block existed, or (ii) grok genuinely echoing a prompt
 * ProseMirror already mutated before submit.
 *
 * REDO of the first pass, which sampled only after waitForGrokCompletion
 * had already returned — a moment where `.last()` is necessarily the
 * assistant node on any completed turn, distinguishing nothing — and used
 * startNewChat, which never runs on the /api/ask path the real echoing
 * turns took (a fresh chat has no prior bubble, no live Copy/Like button,
 * so poll.js's doneSignal check can't fire early the way it could on a
 * page carrying a prior turn).
 *
 * This version: sends ONE throwaway turn first so the page carries a prior
 * user+assistant bubble pair and a live Copy/Like button (the regime real
 * echoing turns ran in), then for the SECOND (measured) turn, samples
 * `.last()` on a short interval CONCURRENTLY with the real, unmodified
 * waitForGrokCompletion() — not after it returns — so the trace covers the
 * exact window poll.js/extract.js actually decide in.
 *
 * Drives the real production functions unmodified — injectGrokText
 * (clearAndType), clickGrokSend, waitForGrokCompletion — with one extra
 * read (composer content before submit) and one extra concurrent sampler
 * (the in-window trace) that production code never takes.
 */
import { chromium } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  injectGrokText,
  clickGrokSend,
} from "../src/ai/grok/interaction/prompt/input.js";
import { waitForGrokCompletion } from "../src/ai/grok/interaction/prompt/poll.js";
import { GROK_LOCATORS } from "../src/ai/grok/locators.js";

// T-132: the selector `.message-bubble, .response-content-markdown,
// div[id^="response-"]` matches three different depths of the same DOM
// subtree, and `.last()` in document order always resolves to the
// innermost one — `.response-content-markdown` — never to the
// `div[id^="response-"]` wrapper that actually carries the alignment
// class. Confirmed on the committed dumps: index 17 (run1) / index 29
// (run2), the node `.last()` returns, has class
// "relative response-content-markdown markdown chat-md chat-md-links
// [&>:first-child:not(.not-prose)]:mt-0 [&>:last-child:not(.not-prose)]:mb-0"
// — no items-end/items-start substring anywhere in it. The alignment class
// lives one level up, on the enclosing div[id^="response-"] (index 15 run1
// / index 27 run2, class "...items-start"; index 12 run1 / index 24 run2,
// class "...items-end"). So checking `.last()`'s OWN class for items-end/
// items-start can never read true — the class check has to walk up to
// that ancestor first.
export function classifyAlignmentClass(className) {
  if (!className) return null;
  if (className.includes("items-end")) return "user";
  if (className.includes("items-start")) return "assistant";
  return null;
}

export function summarizeAlignmentTrace(trace, completedAtMs) {
  const userBubbleAtAnyTick = trace.some((t) => t.lastAlignment === "user");
  const assistantBubbleAtAnyTick = trace.some(
    (t) => t.lastAlignment === "assistant",
  );
  const tickAtCompletion = trace.find((t) => t.tMs >= completedAtMs);
  // T-134: this used to collapse to a boolean
  // (tickAtCompletion.lastAlignment === "user"), which folded "the
  // ancestor was the assistant's" and "we could not read the ancestor at
  // all" into the same `false` — the same shape T-132 fixed for the two
  // AtAnyTick booleans above, still present here. Field NAME is unchanged;
  // the VALUE is now three distinguishable states, not two: "user" |
  // "assistant" | null — null covers both "no tick reached completedAtMs"
  // and "a tick was reached but its own lastAlignment is null" (an
  // unreadable ancestor — see classifyAlignmentClass(null) above). Neither
  // null case is refutable back into "assistant" from this field alone,
  // which is the point.
  const lastNodeWasUserAtCompletionTick = tickAtCompletion
    ? tickAtCompletion.lastAlignment
    : null;
  return {
    userBubbleAtAnyTick,
    assistantBubbleAtAnyTick,
    lastNodeWasUserAtCompletionTick,
  };
}

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
// evidence/, not reports/ — reports/* is gitignored except reports/vision-probe/
// (see CLAUDE.md's "Evidence for live-verified tickets"); a plain `git add`
// on a reports/-rooted path here would silently do nothing.
const outPath =
  process.argv[2] || `evidence/t059-grok-dom-read-${Date.now()}.json`;
const SAMPLE_INTERVAL_MS = 300;
const POST_COMPLETE_SAMPLE_MS = 1500;

// Byte-identical shape to scripts/vision-probe.mjs's buildPrompt() — the
// blank-line structure is what matters here, not the specific count/color
// palette text, and T-072 already established grok echoes this same prompt
// shape blind (no image) at the same rate as the image-turn version.
function buildPrompt() {
  const palette = "crimson, teal, goldenrod, indigo";
  return (
    `Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, ` +
    `no other text:\n\n` +
    `SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest ` +
    `match from exactly this list: ${palette}>\n\n` +
    `...or reply with EXACTLY this if you cannot see any image at all:\n\n` +
    `SEES=no`
  );
}

async function sendTurn(page, prompt) {
  await injectGrokText(page, prompt);
  await clickGrokSend(page);
  return waitForGrokCompletion(page);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("grok.com"));
  if (!page) page = await context.newPage();

  // Deliberately NOT startNewChat — the real echoing turns (T-072, via
  // /api/ask) never call it either. Whatever conversation state the tab
  // already carries is the regime. If it's a genuinely fresh landing page,
  // the throwaway turn below still establishes a prior bubble pair before
  // the measured turn runs.
  console.log(
    "[t059] sending a THROWAWAY turn first, to establish a prior bubble pair + live Copy/Like button...",
  );
  const throwawayCompleted = await sendTurn(page, "Reply with exactly: PONG");
  console.log(`[t059] throwaway turn completed: ${throwawayCompleted}`);
  await page.waitForTimeout(1000);

  const prompt = buildPrompt();
  console.log(
    "[t059] injecting the MEASURED prompt (production injectGrokText/clearAndType)...",
  );
  await injectGrokText(page, prompt);

  // CLAUSE 2 — read the composer's OWN content, after clearAndType, BEFORE
  // submit. This is the read production code never takes.
  const composerLocator = page.locator(GROK_LOCATORS.inputBox).first();
  const composerInnerText = await composerLocator.innerText().catch(() => null);
  console.log(
    `[t059] composer innerText before submit (JSON-escaped): ${JSON.stringify(composerInnerText)}`,
  );

  const selector = GROK_LOCATORS.responseBlock;
  const nodes = page.locator(selector);

  console.log("[t059] clicking send (production clickGrokSend)...");
  await clickGrokSend(page);
  const t0 = Date.now();

  // IN-WINDOW TRACE — sampled CONCURRENTLY with the real
  // waitForGrokCompletion() call below, not after it returns. Records
  // .last()'s own class/id/text at each tick, plus (T-132) the alignment
  // class read off the enclosing div[id^="response-"] ancestor — see the
  // classifyAlignmentClass comment above for why .last()'s OWN class can't
  // carry it — so the trace covers exactly the window poll.js/extract.js
  // decide in, not the steady state after.
  const trace = [];
  let sampling = true;
  const samplerDone = (async () => {
    while (sampling) {
      const count = await nodes.count().catch(() => 0);
      let lastClass = null;
      let lastId = null;
      let lastText = null;
      let lastAlignment = null;
      if (count > 0) {
        const el = nodes.nth(count - 1);
        lastClass = await el.getAttribute("class").catch(() => null);
        lastId = await el.getAttribute("id").catch(() => null);
        lastText = await el
          .innerText()
          .then((t) => t.slice(0, 60))
          .catch(() => null);
        const ancestorClass = await el
          .locator('xpath=ancestor::*[starts-with(@id, "response-")][1]')
          .first()
          .getAttribute("class")
          .catch(() => null);
        lastAlignment = classifyAlignmentClass(ancestorClass);
      }
      trace.push({
        tMs: Date.now() - t0,
        matchCount: count,
        lastClass,
        lastId,
        lastText,
        lastAlignment,
      });
      await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
    }
  })();

  console.log(
    "[t059] waiting for completion (production waitForGrokCompletion) while sampling concurrently...",
  );
  const completed = await waitForGrokCompletion(page);
  const completedAtMs = Date.now() - t0;
  console.log(
    `[t059] waitForGrokCompletion returned: ${completed}, at t=${completedAtMs}ms`,
  );

  // Keep sampling a bit past completion so the trace shows the transition
  // to steady state too, not just cut off at the exact return.
  await new Promise((r) => setTimeout(r, POST_COMPLETE_SAMPLE_MS));
  sampling = false;
  await samplerDone;

  // CLAUSE 1 — final full dump, same as before, for the steady-state
  // picture alongside the in-window trace.
  const finalCount = await nodes.count();
  const dump = [];
  for (let i = 0; i < finalCount; i++) {
    const el = nodes.nth(i);
    const className = await el.getAttribute("class").catch(() => null);
    const id = await el.getAttribute("id").catch(() => null);
    const text = await el
      .innerText()
      .then((t) => t.slice(0, 200))
      .catch(() => null);
    dump.push({ index: i, className, id, innerTextFirst200: text });
  }

  // Does the in-window trace ever show .last() resolving to the USER's own
  // bubble (right-aligned, "items-end") rather than the assistant's
  // ("items-start")? This is the gate clause 1 actually asks for now.
  // T-132: read off trace[].lastAlignment (the ancestor's class), not
  // trace[].lastClass (.last()'s own class, which never carries either
  // substring — see classifyAlignmentClass above).
  const {
    userBubbleAtAnyTick,
    assistantBubbleAtAnyTick,
    lastNodeWasUserAtCompletionTick,
  } = summarizeAlignmentTrace(trace, completedAtMs);

  const result = {
    ts: new Date().toISOString(),
    throwawayCompleted,
    prompt,
    composerInnerTextBeforeSubmit: composerInnerText,
    // T-059 REDO: the T-054 artifacts' actual blank-line character is
    // U+00A0 (non-breaking space), confirmed at the byte level
    // (reports/vision-probe/t054-grok-echo-*.json contain \xc2\xa0, UTF-8
    // for U+00A0) — not a literal space (U+0020). The original predicate
    // tested only U+0020 and could never read true for the thing it was
    // named after.
    // T-059 REDO: the SECOND includes() below, and the regex's
    // [ \t<NBSP>] character class, both contain a literal U+00A0
    // (non-breaking space) -- not a second copy of the plain-space check
    // above. Confirmed at the byte level that T-054's stored artifacts
    // contain 0xC2 0xA0 (UTF-8 for U+00A0), not U+0020. The two calls
    // LOOK identical in a terminal or a diff (NBSP renders as a blank),
    // which is exactly why the original predicate (space only) could
    // never read true for the character it was named after.
    composerContainsSpaceInBlankLine: composerInnerText
      ? composerInnerText.includes("\n \n") ||
        composerInnerText.includes("\n \n") ||
        /\n[ \t ]+\n/.test(composerInnerText)
      : null,
    selectorUsed: selector,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    completedAtMs,
    waitForGrokCompletionReturned: completed,
    inWindowTrace: trace,
    userBubbleAtAnyTick,
    assistantBubbleAtAnyTick,
    lastNodeWasUserAtCompletionTick,
    finalDump: dump,
    finalMatchCount: finalCount,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2));

  console.log(
    `[t059] in-window trace: ${trace.length} samples over ${trace[trace.length - 1]?.tMs ?? 0}ms`,
  );
  trace.forEach((t) =>
    console.log(
      `  t=${String(t.tMs).padStart(6)}ms matchCount=${t.matchCount} lastClass=${JSON.stringify((t.lastClass || "").slice(-30))} lastText="${(t.lastText || "").replace(/\n/g, "\\n")}"`,
    ),
  );
  console.log(
    `[t059] .last() was ever the USER's own bubble (items-end) during the window: ${userBubbleAtAnyTick}`,
  );
  console.log(
    `[t059] .last() was ever the ASSISTANT's bubble (items-start) during the window: ${assistantBubbleAtAnyTick}`,
  );
  console.log(`[t059] report written to ${outPath}`);
}

// T-132: guarded so `import { classifyAlignmentClass, summarizeAlignmentTrace }
// from "./t059-grok-dom-read.mjs"` (the unit test) does not also fire off a
// live grok turn against a bridge — main() only runs when this file is
// executed directly. Same pattern as vision-probe.mjs (T-025).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
