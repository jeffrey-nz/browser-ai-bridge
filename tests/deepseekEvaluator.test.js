import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeepSeekCompletion } from "../src/ai/deepseek/interaction/prompt/poll/evaluator.js";

// T-045: DeepSeek can hold a submitted turn for 25-30s (a client-side
// proof-of-work challenge, confirmed via a live network trace) before its
// own /chat/completion request is even issued. During that window
// isGenerating is false and currentText is "" the whole time — 26 ticks of
// that (POLL_INTERVAL_MS=500ms * 26 > the fallback's 25-iteration/12.5s
// threshold) used to satisfy the idle-completion fallback and declare the
// turn complete before it had even been sent.
test.describe("evaluateDeepSeekCompletion — idle fallback", () => {
  test("does NOT fire on 26 idle ticks if generation was never observed", () => {
    const stateContext = { lastTextLength: 0, stableIterations: 0 };
    const domState = {
      isGenerating: false,
      currentCount: 0,
      currentText: "",
    };
    let result = false;
    for (let i = 0; i < 26; i++) {
      result = evaluateDeepSeekCompletion(domState, stateContext, 0);
    }
    assert.equal(
      result,
      false,
      "must not declare completion for a turn that never started generating",
    );
  });

  test("DOES fire on 26 idle ticks once generation was observed and then stopped", () => {
    const stateContext = { lastTextLength: 0, stableIterations: 0 };

    // Generation starts and produces some text.
    let result = evaluateDeepSeekCompletion(
      { isGenerating: true, currentCount: 1, currentText: "Hello" },
      stateContext,
      0,
    );
    assert.equal(result, false);

    // Generation stops; text has settled. 26 idle ticks with unchanging text.
    const domState = {
      isGenerating: false,
      currentCount: 1,
      currentText: "Hello, world!",
    };
    for (let i = 0; i < 26; i++) {
      result = evaluateDeepSeekCompletion(domState, stateContext, 0);
    }
    assert.equal(
      result,
      true,
      "the original idle-completion fallback must still fire once generation genuinely ran and then stalled",
    );
  });

  test("resets idle count once generation is observed mid-poll", () => {
    const stateContext = { lastTextLength: 0, stableIterations: 0 };
    const idleDomState = {
      isGenerating: false,
      currentCount: 0,
      currentText: "",
    };

    // 20 idle ticks with nothing having started — below the 25 threshold
    // regardless, but exercises the same "never generating" path.
    for (let i = 0; i < 20; i++) {
      evaluateDeepSeekCompletion(idleDomState, stateContext, 0);
    }
    assert.equal(stateContext.everGenerating, undefined);

    // Generation finally starts.
    evaluateDeepSeekCompletion(
      { isGenerating: true, currentCount: 1, currentText: "Hi" },
      stateContext,
      0,
    );
    assert.equal(stateContext.everGenerating, true);
    assert.equal(stateContext.idleIterations, 0);
  });
});
