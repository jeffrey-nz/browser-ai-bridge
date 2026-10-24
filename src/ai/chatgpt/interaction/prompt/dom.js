import { CHATGPT_DOM } from "../../locators.js";

//[[ ONE EVALUATE PER POLL, NEVER A WAITING LOCATOR.
//
//   The poller used `locator(...).last().innerText()`, and a Playwright locator
//   WAITS for its element — 30 s by default — before it gives up. While the
//   selectors matched, that cost nothing. When ChatGPT's DOM moved (2026-10-25)
//   every poll tick became a 30 s wait for an element that would never appear,
//   so the "is it done?" loop could not even notice it was blind. A single
//   page.evaluate answers in milliseconds whether or not anything matches, and it
//   reports WHICH strategy matched, so a miss can be named. ]]

/** Read the conversation's visible state with the ordered strategies in CHATGPT_DOM. */
export async function readChatGptDom(page) {
  return page.evaluate((dom) => {
    const first = (list, root = document) => {
      for (const sel of list) {
        const els = root.querySelectorAll(sel);
        if (els.length) return { sel, els: [...els] };
      }
      return { sel: null, els: [] };
    };
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const turn = first(dom.turn);
    const user = first(dom.user);
    const assistant = first(dom.assistant);
    const stop = first(dom.stop);
    const lastTurn = turn.els[turn.els.length - 1] || null;
    const lastAssistant = assistant.els[assistant.els.length - 1] || null;
    const status = [...document.querySelectorAll('[role="status"]')]
      .map((s) => (s.textContent || "").trim())
      .filter(Boolean);
    return {
      matched: { turn: turn.sel, user: user.sel, assistant: assistant.sel, stop: stop.sel },
      turnCount: turn.els.length,
      userCount: user.els.length,
      assistantCount: assistant.els.length,
      turnState: lastTurn ? lastTurn.getAttribute("data-talvt-turn-state") : null,
      stopVisible: stop.els.some(visible),
      lastAssistantText: lastAssistant ? lastAssistant.innerText || "" : "",
      responseComplete: status.some((s) => /response complete/i.test(s)),
      conversationId: (location.pathname.match(/\/c\/([0-9a-f-]{8,})/i) || [])[1] || null,
    };
  }, CHATGPT_DOM);
}

//[[ THE CONVERSATION API IS THE READ THAT DOES NOT DEPEND ON THE DOM.
//
//   The page's own backend holds the exact markdown the model wrote and a status
//   for it. /api/auth/session hands the signed-in page a bearer token, and
//   /backend-api/conversation/<id> returns the message tree. Both are GETs the
//   page itself makes on every load, so reading them changes nothing. Measured on
//   2026-10-25 against the turn the DOM could not see: current_node was the
//   assistant message, status "finished_successfully", parts ["PONG"]. ]]

/**
 * The newest assistant TEXT message of the open conversation, via the page's own
 * backend. Returns { ok, id, status, text } or { ok: false, why }.
 */
export async function readChatGptConversationApi(page) {
  return page
    .evaluate(async () => {
      const id = (location.pathname.match(/\/c\/([0-9a-f-]{8,})/i) || [])[1];
      if (!id) return { ok: false, why: "no conversation id in the URL yet" };
      const timed = (p, ms) =>
        Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
      try {
        const s = await timed(fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json()), 5000);
        if (!s?.accessToken) return { ok: false, why: "no access token from /api/auth/session" };
        const r = await timed(
          fetch(`/backend-api/conversation/${id}`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${s.accessToken}` },
          }),
          8000,
        );
        if (!r.ok) return { ok: false, why: `conversation API ${r.status}` };
        const j = await r.json();
        let node = j.mapping?.[j.current_node];
        while (node) {
          const m = node.message;
          const ct = m?.content?.content_type;
          if (
            m?.author?.role === "assistant" &&
            (ct === "text" || ct === "multimodal_text") &&
            (!m.recipient || m.recipient === "all")
          ) {
            const text = (m.content.parts || []).filter((p) => typeof p === "string").join("\n");
            return { ok: true, id: m.id, status: m.status || null, text };
          }
          if (m?.author?.role === "user") break; // nothing newer than the last user turn
          node = j.mapping[node.parent];
        }
        return { ok: true, id: null, status: null, text: "" };
      } catch (e) {
        return { ok: false, why: `conversation API: ${e?.message || e}` };
      }
    })
    .catch((e) => ({ ok: false, why: `evaluate failed: ${e?.message || e}` }));
}

/** ChatGPT wraps citations in private-use markers (U+E200 … U+E201); drop them. */
export function stripCitationMarkup(text) {
  return String(text || "")
    .replace(/[^]*/g, "")
    .trim();
}

export const DOM_GRACE_MS = 30_000; // a sent prompt shows a user turn well inside this
export const ASSISTANT_GRACE_MS = 120_000; // no reply element at all, this long after send
export const STABLE_DONE = 4; // settled + Stop gone (polls of ~0.5 s)
export const STABLE_FORCE_DONE = 20; // settled this long even with Stop lingering

/**
 * Decide one poll tick. Pure, so the rules are pinned by tests rather than
 * rediscovered against a live page.
 *
 * @param {object} st       mutable poll state: { baseline, lastLen, stable, sentAt }
 * @param {object} snap     readChatGptDom() result
 * @param {object|null} api readChatGptConversationApi() result, when it was read this tick
 * @param {number} now
 * @returns {{ done: true, source: "dom"|"api", text?: string }
 *          | { done: false }
 *          | { domChanged: string }}   which strategy list stopped matching
 */
export function decideChatGptPoll(st, snap, api, now) {
  const b = st.baseline;
  const newAssistant = snap.assistantCount > b.assistantCount;
  const text = newAssistant ? snap.lastAssistantText || "" : "";

  if (text.length > 0 && text.length === st.lastLen) st.stable++;
  else st.stable = 0;
  st.lastLen = text.length;

  if (newAssistant && text.trim()) {
    if (snap.turnState === "complete" && st.stable >= 2) return { done: true, source: "dom" };
    if (!snap.stopVisible && snap.turnState !== "in_progress" && st.stable >= STABLE_DONE)
      return { done: true, source: "dom" };
    if (st.stable >= STABLE_FORCE_DONE) return { done: true, source: "dom" };
  }

  const apiNew =
    api?.ok && api.id && api.id !== b.apiReplyId && api.text && api.text.trim();
  if (apiNew && api.status === "finished_successfully") {
    // The page's backend has the finished reply. If the DOM can see it too, let
    // the DOM path finish it (it is about to); if the DOM cannot, that is the
    // layout change this exists to survive: answer from the API, and say so.
    if (!newAssistant) return { done: true, source: "api", text: api.text };
  }

  const elapsed = now - st.sentAt;
  if (!apiNew && !newAssistant) {
    const sawTurn =
      snap.userCount > b.userCount || snap.turnCount > b.turnCount || snap.stopVisible;
    if (elapsed > DOM_GRACE_MS && !sawTurn && !snap.conversationId)
      return { domChanged: "user turn" };
    if (elapsed > ASSISTANT_GRACE_MS && !snap.stopVisible && snap.turnState !== "in_progress")
      return { domChanged: "assistant reply" };
  }
  return { done: false };
}

/** What was on the page BEFORE the send, so the poller knows which reply is new. */
export async function captureChatGptBaseline(page) {
  const snap = await readChatGptDom(page).catch(() => null);
  let apiReplyId = null;
  if (snap?.conversationId) {
    const api = await readChatGptConversationApi(page);
    if (api.ok) apiReplyId = api.id;
  }
  return {
    turnCount: snap?.turnCount || 0,
    userCount: snap?.userCount || 0,
    assistantCount: snap?.assistantCount || 0,
    apiReplyId,
  };
}
