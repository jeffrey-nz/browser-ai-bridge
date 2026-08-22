import { test } from "node:test";
import assert from "node:assert/strict";
import { capturePageContext } from "../src/heal/index.js";

/**
 * T-125: src/heal/index.js's one live export (both src/routes/sessions.js
 * and src/routes/ask/executor/stallLoop.js import it, nothing else in
 * src/heal/ is reachable) had zero tests. This pins its order, its
 * threshold, its three independent failure paths, and its truncation —
 * same fake-page seam as tests/locatorResolution.test.js: a duck-typed page
 * object, no real browser.
 *
 * chatSelectors, in order (src/heal/index.js): #chat-container, main,
 * .ds-chat-container, [class*="chat"], [class*="conversation"], body.
 */

function longHtml(label, len = 600) {
  // >500 chars, and the label makes WHICH candidate won identifiable without
  // relying on length alone.
  return `<${label}>` + "x".repeat(len) + `</${label}>`;
}

function fakePage({ screenshot = {}, selectors = {}, content = {} } = {}) {
  return {
    async screenshot() {
      if (screenshot.throws)
        throw new Error(screenshot.message || "screenshot failed");
      return Buffer.from(screenshot.data ?? "fake-png-bytes");
    },
    locator(sel) {
      const cfg = selectors[sel] || {};
      return {
        first() {
          return {
            async isVisible() {
              if (cfg.isVisibleThrows) throw new Error("isVisible failed");
              return !!cfg.visible;
            },
            async innerHTML() {
              if (cfg.innerHTMLThrows) throw new Error("innerHTML failed");
              return cfg.html ?? "";
            },
          };
        },
      };
    },
    async content() {
      if (content.throws) throw new Error(content.message || "content failed");
      return content.html ?? "";
    },
  };
}

test("capturePageContext: the EARLIER chatSelectors entry wins when a later one would also match", async () => {
  // #chat-container (first) and main (second) are both visible with >500
  // chars of content — only walking the list IN ORDER and stopping at the
  // first hit can explain getting #chat-container's content back.
  const page = fakePage({
    selectors: {
      "#chat-container": { visible: true, html: longHtml("chat-container") },
      main: { visible: true, html: longHtml("main") },
    },
  });
  const { htmlSnippet } = await capturePageContext(page);
  assert.ok(htmlSnippet.startsWith("<chat-container>"));
  assert.ok(!htmlSnippet.includes("<main>"));
});

test("capturePageContext: a visible candidate under the 500-char threshold is SKIPPED, not returned", async () => {
  // #chat-container is visible but short (< 500 chars) — must be passed
  // over. main is visible with real content and must win instead.
  const page = fakePage({
    selectors: {
      "#chat-container": {
        visible: true,
        html: "<chat-container>short</chat-container>",
      },
      main: { visible: true, html: longHtml("main") },
    },
  });
  const { htmlSnippet } = await capturePageContext(page);
  assert.ok(
    htmlSnippet.startsWith("<main>"),
    `expected the short #chat-container match to be skipped and main to win, got: ${htmlSnippet.slice(0, 40)}`,
  );
});

test("capturePageContext: nothing in chatSelectors clears the threshold -> falls back to page.content()", async () => {
  const page = fakePage({
    selectors: {}, // every locator: not visible (cfg defaults to {})
    content: { html: longHtml("fallback-body") },
  });
  const { htmlSnippet } = await capturePageContext(page);
  assert.ok(htmlSnippet.startsWith("<fallback-body>"));
});

test("capturePageContext: page.screenshot() throwing does not stop the HTML capture — the two are independent", async () => {
  const page = fakePage({
    screenshot: { throws: true },
    selectors: {
      "#chat-container": { visible: true, html: longHtml("chat-container") },
    },
  });
  const { screenshotBase64, htmlSnippet } = await capturePageContext(page);
  assert.equal(screenshotBase64, null);
  assert.ok(
    htmlSnippet.startsWith("<chat-container>"),
    "htmlSnippet must still be populated when only the screenshot failed",
  );
});

test("capturePageContext: the HTML capture throwing leaves htmlSnippet empty but does not throw, and does not touch the screenshot", async () => {
  const page = fakePage({
    selectors: {}, // nothing visible -> falls through to page.content()
    content: { throws: true }, // -> caught by the outer try/catch
  });
  const { screenshotBase64, htmlSnippet } = await capturePageContext(page);
  assert.equal(htmlSnippet, "");
  assert.equal(
    screenshotBase64,
    Buffer.from("fake-png-bytes").toString("base64"),
  );
});

test('capturePageContext: both captures failing resolves to { screenshotBase64: null, htmlSnippet: "" }, no throw', async () => {
  const page = fakePage({
    screenshot: { throws: true },
    selectors: {},
    content: { throws: true },
  });
  const result = await capturePageContext(page);
  assert.deepEqual(result, { screenshotBase64: null, htmlSnippet: "" });
});

test("capturePageContext: a matched selector's HTML is truncated to 12000 chars", async () => {
  const page = fakePage({
    selectors: {
      "#chat-container": {
        visible: true,
        html: longHtml("chat-container", 20000),
      },
    },
  });
  const { htmlSnippet } = await capturePageContext(page);
  assert.equal(htmlSnippet.length, 12000);
});

test("capturePageContext: the page.content() fallback is also truncated to 12000 chars", async () => {
  const page = fakePage({
    selectors: {},
    content: { html: longHtml("fallback-body", 20000) },
  });
  const { htmlSnippet } = await capturePageContext(page);
  assert.equal(htmlSnippet.length, 12000);
});
