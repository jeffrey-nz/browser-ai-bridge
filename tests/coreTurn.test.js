import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCoreTurn } from "../src/routes/ask/executor/coreTurn.js";

/**
 * T-004: an engine with no sendPromptWithFile must not silently drop an
 * image and answer as text with success:true and no way to tell. Pinned
 * with a stub engine rather than a live browser — this is a wiring
 * question, not a DOM one.
 */

function fakeSession(engine) {
  return { id: "test-session", providerId: "fake-provider", engine };
}

test("an image sent to an engine with no sendPromptWithFile comes back imageAttached:false, not a bare success", async () => {
  const engine = {
    // Deliberately no sendPromptWithFile — this is the exact shape T-004
    // found: only sendPromptAndWait exists.
    sendPromptAndWait: async () => ({ ok: true, text: "a fluent answer" }),
  };

  const result = await executeCoreTurn(
    fakeSession(engine),
    "describe the attached image",
    "test",
    5000,
    { attachmentPaths: ["/tmp/some-image.png"] },
  );

  assert.equal(
    result.imageAttached,
    false,
    "an image the engine cannot take must be reported as not attached, not omitted",
  );
});

test("a text-only turn on the same file-less engine gains no spurious imageAttached", async () => {
  const engine = {
    sendPromptAndWait: async () => ({ ok: true, text: "a fluent answer" }),
  };

  const result = await executeCoreTurn(
    fakeSession(engine),
    "just text, no image",
    "test",
    5000,
    { attachmentPaths: [] },
  );

  assert.equal(
    result.imageAttached,
    undefined,
    "a turn that never carried an image must not gain an imageAttached field at all — " +
      "two states (never sent / sent-but-dropped) must stay distinguishable",
  );
});

test("an engine WITH sendPromptWithFile is still used and unaffected by the fallback path", async () => {
  let calledWithFile = false;
  const engine = {
    sendPromptWithFile: async () => {
      calledWithFile = true;
      return { ok: true, text: "saw it", imageAttached: true };
    },
    sendPromptAndWait: async () => ({ ok: true, text: "should not be called" }),
  };

  const result = await executeCoreTurn(
    fakeSession(engine),
    "describe the attached image",
    "test",
    5000,
    { attachmentPaths: ["/tmp/some-image.png"] },
  );

  assert.equal(calledWithFile, true);
  assert.equal(result.imageAttached, true);
  assert.equal(result.text, "saw it");
});
