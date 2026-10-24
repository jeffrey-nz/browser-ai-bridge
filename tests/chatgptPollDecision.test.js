import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideChatGptPoll,
  stripCitationMarkup,
  DOM_GRACE_MS,
  ASSISTANT_GRACE_MS,
} from "../src/ai/chatgpt/interaction/prompt/dom.js";

/**
 * 2026-10-25: ChatGPT's DOM moved and every ask ran to the 5-minute timeout with
 * the answer on screen. These pin the poller's rules without a browser: a reply
 * the DOM sees finishes from the DOM, one only the conversation API sees finishes
 * from the API, and a page where NEITHER sees anything fails as "provider DOM
 * changed: <which>" instead of hanging.
 */

const base = { turnCount: 0, userCount: 0, assistantCount: 0, apiReplyId: null };
const state = (over = {}) => ({ baseline: base, lastLen: 0, stable: 0, sentAt: 0, ...over });
const snap = (over = {}) => ({
  matched: {},
  turnCount: 1,
  userCount: 1,
  assistantCount: 1,
  turnState: "complete",
  stopVisible: false,
  lastAssistantText: "PONG",
  responseComplete: true,
  conversationId: "abc12345",
  ...over,
});

function run(st, s, api, ticks, start = 1000) {
  let v;
  for (let i = 0; i < ticks; i++) v = decideChatGptPoll(st, s, api, start + i * 500);
  return v;
}

test("a completed turn the DOM can see finishes from the DOM once the text settles", () => {
  const st = state();
  assert.equal(decideChatGptPoll(st, snap(), null, 1000).done, false);
  const v = run(st, snap(), null, 3);
  assert.deepEqual(v, { done: true, source: "dom" });
});

test("a turn still in progress with Stop showing is not done", () => {
  const st = state();
  const v = run(st, snap({ turnState: "in_progress", stopVisible: true }), null, 10);
  assert.deepEqual(v, { done: false });
});

test("Stop lingering on settled text is forced done (the old hang)", () => {
  const st = state();
  const v = run(st, snap({ turnState: null, stopVisible: true }), null, 25);
  assert.deepEqual(v, { done: true, source: "dom" });
});

test("the previous turn's reply is not mistaken for the new one", () => {
  const st = state({ baseline: { ...base, assistantCount: 1, turnCount: 1, userCount: 1 } });
  const v = run(st, snap(), null, 10);
  assert.deepEqual(v, { done: false });
});

test("DOM blind, API has the finished reply: done from the API with its text", () => {
  const st = state();
  const blind = snap({ assistantCount: 0, turnCount: 0, userCount: 0, turnState: null, lastAssistantText: "" });
  const api = { ok: true, id: "m2", status: "finished_successfully", text: "PONG" };
  assert.deepEqual(decideChatGptPoll(st, blind, api, 5000), { done: true, source: "api", text: "PONG" });
});

test("the API's reply from before the send does not count", () => {
  const st = state({ baseline: { ...base, apiReplyId: "m1" } });
  const blind = snap({ assistantCount: 0, turnState: null, lastAssistantText: "" });
  const api = { ok: true, id: "m1", status: "finished_successfully", text: "old" };
  assert.deepEqual(decideChatGptPoll(st, blind, api, 5000), { done: false });
});

test("no user turn, no conversation, past the grace: provider DOM changed: user turn", () => {
  const st = state();
  const nothing = snap({ assistantCount: 0, turnCount: 0, userCount: 0, turnState: null, lastAssistantText: "", conversationId: null });
  assert.deepEqual(decideChatGptPoll(st, nothing, null, DOM_GRACE_MS - 1), { done: false });
  assert.deepEqual(decideChatGptPoll(st, nothing, null, DOM_GRACE_MS + 1), { domChanged: "user turn" });
});

test("a user turn but never any reply element and nothing generating: provider DOM changed: assistant reply", () => {
  const st = state();
  const noReply = snap({ assistantCount: 0, turnState: null, lastAssistantText: "" });
  assert.deepEqual(decideChatGptPoll(st, noReply, null, ASSISTANT_GRACE_MS - 1), { done: false });
  assert.deepEqual(decideChatGptPoll(st, noReply, null, ASSISTANT_GRACE_MS + 1), { domChanged: "assistant reply" });
});

test("a slow reply that is visibly generating is never called a DOM change", () => {
  const st = state();
  const thinking = snap({ assistantCount: 0, turnState: "in_progress", stopVisible: true, lastAssistantText: "" });
  assert.deepEqual(decideChatGptPoll(st, thinking, null, ASSISTANT_GRACE_MS * 2), { done: false });
});

test("citation markers are stripped from API text", () => {
  assert.equal(stripCitationMarkup("Paris citeturn0search0 is big."), "Paris  is big.");
});
