import { test } from "node:test";
import assert from "node:assert/strict";
import { hasBridgeMark } from "../src/browser/inherited.js";

// 2026-10-31: tabs a person opened to sign in, while the bridge ran, were adopted or
// closed as "orphans". Only a tab the bridge stamped is the bridge's.
const page = (marked) => ({ isClosed: () => false, evaluate: async () => marked });

test("a stamped tab is the bridge's, and an unstamped one is not", async () => {
  assert.equal(await hasBridgeMark(page(true)), true);
  assert.equal(await hasBridgeMark(page(false)), false);
});

test("a tab that cannot answer is not the bridge's", async () => {
  assert.equal(await hasBridgeMark({ isClosed: () => false }), false);
  assert.equal(await hasBridgeMark({ isClosed: () => true, evaluate: async () => true }), false);
  assert.equal(await hasBridgeMark(null), false);
});
