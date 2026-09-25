import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASK = fs.readFileSync(
  path.join(HERE, "..", "src", "routes", "ask.js"),
  "utf8",
);

/**
 * req "close" STOPPED MEANING "THE CLIENT LEFT", AND NOTHING NOTICED.
 *
 * ask.js used to listen only on req "close", with a comment explaining that it
 * "fires immediately when the client drops the TCP connection". True of older
 * Node. Since Node 16 an IncomingMessage emits "close" when the REQUEST STREAM
 * completes — for a POST, as soon as body-parser has read the body — which is
 * BEFORE withSessionLock sets session.locked = true. The guard saw locked ===
 * false, did nothing, and the event never came again.
 *
 * Measured 2026-09-24: "Client disconnected mid-turn" had fired ZERO times in
 * the entire bridge log, and a deliberate abort probe produced none either. So
 * clientGone was never set on any session, TabJanitor's abandoned-turn rule
 * (which requires it) could never fire, and nothing else can reclaim a LOCKED
 * session — the per-provider ceiling only evicts idle ones. Result while
 * generating tl-en/learn-tagalog: 22 tabs, chatgpt holding 7 sessions and
 * perplexity 5 against a cap of 3, all locked, with the janitor correctly
 * reporting `wouldClose: []`.
 *
 * After adding res "close", the same probe logged
 *   [Ask] Client disconnected mid-turn for session f4ace545 - force-releasing stale lock
 * and the session unlocked.
 *
 * These are source-shape assertions on purpose: the behaviour needs a live
 * socket to exercise, and what regressed was a single missing listener.
 */

test('the response close event is listened for — req "close" alone cannot see a disconnect', () => {
  assert.match(
    ASK,
    /res\.on\("close", onClose\)/,
    'res "close" is the only one of the two that still means "the caller went away"',
  );
});

test('req "close" is kept too — it costs nothing and still fires on an early drop', () => {
  assert.match(ASK, /req\.on\("close", onClose\)/);
});

test("both listeners are removed when the turn ends, so a long-lived socket leaks neither", () => {
  assert.match(ASK, /req\.off\("close", onClose\)/);
  assert.match(ASK, /res\.off\("close", onClose\)/);
});

test("the guard still tells a finished response from an abandoned one", () => {
  //[[ The half that must not regress: res "close" ALSO fires on a normal
  //   completion. Without !res.writableEnded every successful turn would be
  //   recorded as an abandoned one and its session marked needsReset. ]]
  assert.match(ASK, /if \(!res\.writableEnded && session\.locked\)/);
});

test("a disconnect sets the three things TabJanitor and the executor read", () => {
  const from = ASK.indexOf("const onClose");
  const body = ASK.slice(from, ASK.indexOf('req.on("close"', from));
  assert.match(
    body,
    /session\.locked = false/,
    "the lock must be released at once",
  );
  assert.match(
    body,
    /session\.needsReset = true/,
    "the page is mid-turn and must be reset before reuse",
  );
  assert.match(
    body,
    /session\.clientGone = true/,
    "TabJanitor's abandoned rule keys on this",
  );
  assert.match(
    body,
    /session_abort:/,
    "gemini and chatgpt polls listen for this",
  );
});

test("the stale comment that caused it is gone", () => {
  assert.doesNotMatch(
    ASK,
    /req "close" fires\s*\n?\s*\/\/\s*immediately when the client drops/,
    "the claim that req close means a TCP drop is what made this look correct",
  );
});
