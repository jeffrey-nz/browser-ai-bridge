import { test } from "node:test";
import assert from "node:assert/strict";
import { makeInteraction } from "../src/ai/generic/interaction.js";
import { GENERIC_SPECS } from "../src/ai/generic/specs.js";

/**
 * readAnswer picks WHICH element is the answer, and waitForCompletion stabilises
 * on that element's length. So the choice decides whether a turn completes at
 * all — not just how tidy the text is.
 *
 * `.last()` was the wrong choice for a NESTED match. Measured live on
 * chat.qwen.ai (2026-09-24), one assistant turn matched qwen's responseBlock
 * selector THIRTEEN times, because the answer container, the markdown wrapper,
 * the code block and that block's header/body/viewport all carry a class
 * containing "markdown" or "message"+"content". The thirteenth and last was
 * `qwen-markdown-code-horizontal-scroll-proxy-content`, an empty scroll shim, so
 * readAnswer returned "". waitForCompletion requires `len > 0 && len === lastLen`
 * and a permanent 0 never satisfies it: the poll ran its full 300000ms and the
 * turn died as a timeout, on a page where the model had answered a minute
 * earlier. It read as a slow provider and it was an unreadable selector.
 *
 * These pin the replacement — the last OUTERMOST match — and, just as
 * importantly, pin what it must NOT become: "longest", which the function's old
 * one-line description wrongly claimed. An earlier turn in the same session can
 * be longer than the current one, and answering with it would be silent
 * corruption instead of a visible timeout.
 */

/**
 * A fake page whose `evaluateAll` runs the real callback against plain objects
 * standing in for elements. `contains` is what the production filter uses, so
 * the fixtures declare containment directly.
 */
function fakePage(nodes) {
  const elements = nodes.map((n) => ({
    innerText: n.text,
    _id: n.id,
    _contains: n.contains || [],
    contains(other) {
      return this._contains.includes(other._id);
    },
  }));
  return {
    locator() {
      return {
        async evaluateAll(fn) {
          return fn(elements);
        },
        last() {
          return {
            async innerText() {
              const el = elements[elements.length - 1];
              return el ? el.innerText : "";
            },
          };
        },
      };
    },
  };
}

test("qwen's real 13-element nested turn: reads the answer, not the empty scroll shim", async () => {
  const { readAnswer } = makeInteraction(GENERIC_SPECS.qwen);
  // The shape measured on chat.qwen.ai: one outermost answer container holding
  // every other match, with the empty scroll proxy last in document order.
  const page = fakePage([
    {
      id: "container",
      text: "the real answer",
      contains: ["markdown", "codeBody", "scrollProxy"],
    },
    { id: "markdown", text: "the real answer", contains: ["codeBody", "scrollProxy"] },
    { id: "codeBody", text: "the real answer", contains: ["scrollProxy"] },
    { id: "scrollProxy", text: "" },
  ]);
  assert.equal(await readAnswer(page), "the real answer");
});

test("the empty shim is what `.last()` would have returned — the fixture proves the bug is real", async () => {
  // Guards the fixture itself: if this ever stops being "", the fixture has
  // drifted away from the DOM that caused the outage and the test above proves
  // nothing.
  const page = fakePage([
    { id: "container", text: "the real answer", contains: ["scrollProxy"] },
    { id: "scrollProxy", text: "" },
  ]);
  assert.equal(await page.locator().last().innerText(), "");
});

test("a LONGER earlier turn does not win — recency still decides, so 'longest' is not the rule", async () => {
  const { readAnswer } = makeInteraction(GENERIC_SPECS.qwen);
  const page = fakePage([
    { id: "turn1", text: "a much longer answer from the previous turn in this session" },
    { id: "turn2", text: "short reply" },
  ]);
  assert.equal(
    await readAnswer(page),
    "short reply",
    "answering with an older turn is silent corruption; a timeout at least shows up",
  );
});

test("when no match nests, this is exactly `.last()` — no behaviour change for flat specs", async () => {
  const { readAnswer } = makeInteraction(GENERIC_SPECS.mistral);
  const page = fakePage([
    { id: "a", text: "first" },
    { id: "b", text: "second" },
    { id: "c", text: "third" },
  ]);
  assert.equal(await readAnswer(page), "third");
});

test("no matches at all reads as empty, not as a crash", async () => {
  const { readAnswer } = makeInteraction(GENERIC_SPECS.qwen);
  assert.equal(await readAnswer(fakePage([])), "");
});

test("a page without evaluateAll falls back to the original single-element read", async () => {
  //[[ Playwright's locator gains and loses methods across versions, and a page
  //   that navigates mid-poll can reject the evaluate outright. The fallback is
  //   the pre-fix behaviour, which is worse but never throws. ]]
  const { readAnswer } = makeInteraction(GENERIC_SPECS.qwen);
  const page = {
    locator() {
      return {
        evaluateAll() {
          return Promise.reject(new Error("Execution context was destroyed"));
        },
        last: () => ({ innerText: async () => "fallback text" }),
      };
    },
  };
  assert.equal(await readAnswer(page), "fallback text");
});
