import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExistingPages,
  isInheritedPage,
  stampBridgeOwned,
  BRIDGE_MARK_KEY,
} from "../src/browser/inherited.js";
import { providerForUrl } from "../src/session/TabJanitor.js";

/**
 * A restarted bridge must not close, adopt or navigate a tab it did not open
 * (2026-10-25: the bridge's Chrome also holds other sessions' Stripe, Gumroad,
 * itch.io and Play Console tabs). Pages open at connect are inherited unless they
 * carry the bridge's sessionStorage mark. Fake pages: no browser involved.
 */

function fakePage(url, storage = {}) {
  return {
    url: () => url,
    isClosed: () => false,
    evaluate: async (fn, key) => {
      // Run the page function against a fake sessionStorage.
      const sessionStorage = {
        getItem: (k) => storage[k] ?? null,
        setItem: (k, v) => {
          storage[k] = v;
        },
      };
      return new Function("sessionStorage", "k", `return (${fn.toString()})(k)`)(sessionStorage, key);
    },
    storage,
  };
}

test("every non-provider tab open at connect is inherited, never a candidate", async () => {
  const stripe = fakePage("https://dashboard.stripe.com/payments");
  const blank = fakePage("about:blank");
  const play = fakePage("https://play.google.com/console/u/0/developers/1/account");
  await classifyExistingPages([stripe, blank, play], providerForUrl);
  for (const p of [stripe, blank, play]) assert.equal(isInheritedPage(p), true);
});

test("a provider-domain tab without the bridge's mark is inherited (someone else's chatgpt tab)", async () => {
  const someones = fakePage("https://chatgpt.com/c/123");
  const kimiBlog = fakePage("https://www.kimi.ai/blog/kimi-k3-1-pro");
  await classifyExistingPages([someones, kimiBlog], providerForUrl);
  assert.equal(isInheritedPage(someones), true);
  assert.equal(isInheritedPage(kimiBlog), true);
});

test("a provider tab carrying the mark is proven ours and stays usable", async () => {
  const ours = fakePage("https://gemini.google.com/app", { [BRIDGE_MARK_KEY]: "1" });
  const r = await classifyExistingPages([ours], providerForUrl);
  assert.equal(isInheritedPage(ours), false);
  assert.equal(r.provenOurs, 1);
});

test("a non-provider page is never read or adopted, even if it somehow has the mark", async () => {
  const odd = fakePage("https://itch.io/login", { [BRIDGE_MARK_KEY]: "1" });
  await classifyExistingPages([odd], providerForUrl);
  assert.equal(isInheritedPage(odd), true);
});

test("stampBridgeOwned writes the mark a later bridge reads", async () => {
  const p = fakePage("https://chat.deepseek.com/");
  await stampBridgeOwned(p);
  assert.ok(p.storage[BRIDGE_MARK_KEY]);
});

test("a page whose evaluate hangs or throws stays inherited", async () => {
  const broken = {
    url: () => "https://chatgpt.com/",
    isClosed: () => false,
    evaluate: async () => {
      throw new Error("Execution context was destroyed");
    },
  };
  await classifyExistingPages([broken], providerForUrl);
  assert.equal(isInheritedPage(broken), true);
});
