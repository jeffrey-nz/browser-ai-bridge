import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sweep,
  startTabJanitor,
  stopTabJanitor,
} from "../src/session/TabJanitor.js";

const quietLog = { info() {}, warn() {} };

// Own file: stopTabJanitor() latches module state for the rest of the process.
test("stopTabJanitor waits for a running sweep, then refuses new ones", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let contextCalls = 0;
  const getContext = async () => {
    contextCalls++;
    await gate;
    throw new Error("no browser in this test");
  };
  const running = sweep({ manager: {}, pool: {}, getContext, log: quietLog });

  let stopped = false;
  const stopping = stopTabJanitor().then(() => (stopped = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(stopped, false, "stop must wait for the in-flight sweep");

  release();
  await running;
  await stopping;
  assert.equal(stopped, true);

  assert.equal(
    await sweep({ manager: {}, pool: {}, getContext, log: quietLog }),
    null,
  );
  assert.equal(contextCalls, 1, "no sweep may start after stop");
});

test("a sweep that never finishes cannot hold stop forever", async () => {
  const never = () => new Promise(() => {});
  // Restarting clears the latch the first test set; the long interval never
  // fires during the test.
  startTabJanitor({
    manager: {},
    pool: {},
    getContext: never,
    intervalMs: 1e9,
  });
  sweep({ manager: {}, pool: {}, getContext: never, log: quietLog });
  const t0 = Date.now();
  await stopTabJanitor({ waitMs: 50 });
  assert.ok(Date.now() - t0 < 1000, "stop gave up waiting after waitMs");
});
