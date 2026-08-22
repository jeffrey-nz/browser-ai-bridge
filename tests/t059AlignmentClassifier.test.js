import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAlignmentClass,
  summarizeAlignmentTrace,
} from "../scripts/t059-grok-dom-read.mjs";

// Real strings copied out of evidence/t059-grok-inwindow-run1.json's
// finalDump — not guessed. Index 12/15 are the div[id^="response-"]
// wrapper class the fix reads (the ancestor); index 17 is .last()'s OWN
// class, i.e. the string the pre-T-132 predicate checked and which can
// never carry items-end/items-start.
const RUN1_USER_WRAPPER_CLASS =
  "relative group flex flex-col justify-center w-full max-w-(--content-max-width) mx-auto pb-0.5 items-end";
const RUN1_ASSISTANT_WRAPPER_CLASS =
  "relative group flex flex-col justify-center w-full max-w-(--content-max-width) mx-auto pb-0.5 items-start";
const RUN1_LAST_NODE_OWN_CLASS =
  "relative response-content-markdown markdown chat-md chat-md-links [&>:first-child:not(.not-prose)]:mt-0 [&>:last-child:not(.not-prose)]:mb-0";

test("classifyAlignmentClass reads user off the real items-end wrapper class", () => {
  assert.equal(classifyAlignmentClass(RUN1_USER_WRAPPER_CLASS), "user");
});

test("classifyAlignmentClass reads assistant off the real items-start wrapper class", () => {
  assert.equal(
    classifyAlignmentClass(RUN1_ASSISTANT_WRAPPER_CLASS),
    "assistant",
  );
});

test("classifyAlignmentClass returns null on .last()'s own class — proves the old check could never read true", () => {
  assert.equal(classifyAlignmentClass(RUN1_LAST_NODE_OWN_CLASS), null);
});

test("classifyAlignmentClass returns null on a missing class", () => {
  assert.equal(classifyAlignmentClass(null), null);
});

test("summarizeAlignmentTrace reports user for a sample shaped like the user's node and assistant for one shaped like the assistant's", () => {
  const trace = [
    {
      tMs: 13,
      matchCount: 18,
      lastClass: RUN1_LAST_NODE_OWN_CLASS,
      lastId: null,
      lastText: "",
      lastAlignment: classifyAlignmentClass(RUN1_USER_WRAPPER_CLASS),
    },
    {
      tMs: 337,
      matchCount: 18,
      lastClass: RUN1_LAST_NODE_OWN_CLASS,
      lastId: null,
      lastText: "SEES=no",
      lastAlignment: classifyAlignmentClass(RUN1_ASSISTANT_WRAPPER_CLASS),
    },
  ];

  const result = summarizeAlignmentTrace(trace, 337);

  assert.equal(result.userBubbleAtAnyTick, true);
  assert.equal(result.assistantBubbleAtAnyTick, true);
  // T-134: the completion-tick field's value IS the alignment string, not
  // a boolean — see summarizeAlignmentTrace's own comment.
  assert.equal(result.lastNodeWasUserAtCompletionTick, "assistant");
});

test("summarizeAlignmentTrace's completion-tick field is null when no sample reaches completedAtMs", () => {
  const trace = [
    {
      tMs: 13,
      matchCount: 18,
      lastClass: RUN1_LAST_NODE_OWN_CLASS,
      lastId: null,
      lastText: "",
      lastAlignment: classifyAlignmentClass(RUN1_ASSISTANT_WRAPPER_CLASS),
    },
  ];

  const result = summarizeAlignmentTrace(trace, 5000);

  assert.equal(result.lastNodeWasUserAtCompletionTick, null);
});

test("summarizeAlignmentTrace matches the two committed reports: both AtAnyTick booleans false when every tick's ancestor was the assistant's", () => {
  // Reproduces the actual shape of evidence/t059-grok-inwindow-run1.json
  // and -run2.json: .last() was the assistant's node at every sampled
  // tick in both runs (T-059's finding, unchanged by this fix).
  const trace = [
    {
      tMs: 13,
      matchCount: 18,
      lastClass: RUN1_LAST_NODE_OWN_CLASS,
      lastId: null,
      lastText: "",
      lastAlignment: classifyAlignmentClass(RUN1_ASSISTANT_WRAPPER_CLASS),
    },
    {
      tMs: 663,
      matchCount: 18,
      lastClass: RUN1_LAST_NODE_OWN_CLASS,
      lastId: null,
      lastText: "SEES=no",
      lastAlignment: classifyAlignmentClass(RUN1_ASSISTANT_WRAPPER_CLASS),
    },
  ];

  const result = summarizeAlignmentTrace(trace, 663);

  assert.equal(result.userBubbleAtAnyTick, false);
  assert.equal(result.assistantBubbleAtAnyTick, true);
  assert.equal(result.lastNodeWasUserAtCompletionTick, "assistant");
});

// T-134: the completion-tick field used to collapse "the ancestor was the
// assistant's" and "we could not read the ancestor at all" into the same
// `false`. These two cases must now read differently.
test("summarizeAlignmentTrace's completion-tick field distinguishes an unreadable ancestor (matchCount 0) from a genuinely-read assistant ancestor", () => {
  const unreadableTrace = [
    {
      tMs: 20,
      matchCount: 0,
      lastClass: null,
      lastId: null,
      lastText: null,
      lastAlignment: null,
    },
  ];
  const assistantTrace = [
    {
      tMs: 20,
      matchCount: 18,
      lastClass: RUN1_LAST_NODE_OWN_CLASS,
      lastId: null,
      lastText: "SEES=no",
      lastAlignment: classifyAlignmentClass(RUN1_ASSISTANT_WRAPPER_CLASS),
    },
  ];

  const unreadableResult = summarizeAlignmentTrace(unreadableTrace, 20);
  const assistantResult = summarizeAlignmentTrace(assistantTrace, 20);

  assert.equal(unreadableResult.lastNodeWasUserAtCompletionTick, null);
  assert.equal(assistantResult.lastNodeWasUserAtCompletionTick, "assistant");
  assert.notEqual(
    unreadableResult.lastNodeWasUserAtCompletionTick,
    assistantResult.lastNodeWasUserAtCompletionTick,
  );
});
