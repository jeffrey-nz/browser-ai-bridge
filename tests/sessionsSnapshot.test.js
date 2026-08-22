import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/server.js";
import { sessionManager } from "../src/session/index.js";

/**
 * T-131: GET /api/sessions/:id/snapshot hands capturePageContext's result
 * straight through — a total capture failure and a genuinely empty page
 * both used to read screenshotBase64:null, html:"" with no way to tell them
 * apart. screenshotFailed/htmlFailed make that distinguishable from the
 * response alone. Registers a real session (via sessionManager.registry,
 * the same seam SessionRegistry.add exposes) with a duck-typed page — no
 * real browser needed, same approach as tests/capturePageContext.test.js.
 */
function fakePage({ screenshot = {}, selectors = {}, content = {} } = {}) {
  return {
    isClosed: () => false,
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

function registerSession(id, page, providerId = "chatgpt") {
  sessionManager.registry.add(id, {
    id,
    providerId,
    page,
    createdAt: new Date(),
    lastUsedAt: Date.now(),
  });
}

test("GET /api/sessions/:id/snapshot: a real capture reports screenshotFailed:false and htmlFailed:false", async () => {
  const id = "t131-both-succeed";
  registerSession(
    id,
    fakePage({
      selectors: {
        "#chat-container": { visible: true, html: "<x>" + "y".repeat(600) },
      },
    }),
  );
  try {
    const res = await request(app).get(`/api/sessions/${id}/snapshot`);
    assert.equal(res.status, 200);
    assert.equal(res.body.screenshotFailed, false);
    assert.equal(res.body.htmlFailed, false);
    assert.notEqual(res.body.screenshotBase64, null);
    assert.notEqual(res.body.html, "");
  } finally {
    sessionManager.registry.delete(id);
  }
});

test("GET /api/sessions/:id/snapshot: screenshot failure alone sets screenshotFailed:true, htmlFailed:false", async () => {
  const id = "t131-screenshot-fails";
  registerSession(
    id,
    fakePage({
      screenshot: { throws: true },
      selectors: {
        "#chat-container": { visible: true, html: "<x>" + "y".repeat(600) },
      },
    }),
  );
  try {
    const res = await request(app).get(`/api/sessions/${id}/snapshot`);
    assert.equal(res.status, 200);
    assert.equal(res.body.screenshotFailed, true);
    assert.equal(res.body.htmlFailed, false);
    assert.equal(res.body.screenshotBase64, null);
  } finally {
    sessionManager.registry.delete(id);
  }
});

test("GET /api/sessions/:id/snapshot: html capture failure alone sets htmlFailed:true, screenshotFailed:false", async () => {
  const id = "t131-html-fails";
  registerSession(
    id,
    fakePage({
      selectors: {}, // nothing visible -> falls through to page.content()
      content: { throws: true },
    }),
  );
  try {
    const res = await request(app).get(`/api/sessions/${id}/snapshot`);
    assert.equal(res.status, 200);
    assert.equal(res.body.htmlFailed, true);
    assert.equal(res.body.screenshotFailed, false);
    assert.equal(res.body.html, "");
    assert.notEqual(res.body.screenshotBase64, null);
  } finally {
    sessionManager.registry.delete(id);
  }
});

test("GET /api/sessions/:id/snapshot: total capture failure sets BOTH flags true — this is the case that used to be silent", async () => {
  const id = "t131-both-fail";
  registerSession(
    id,
    fakePage({
      screenshot: { throws: true },
      selectors: {},
      content: { throws: true },
    }),
  );
  try {
    const res = await request(app).get(`/api/sessions/${id}/snapshot`);
    assert.equal(res.status, 200);
    assert.equal(res.body.screenshotFailed, true);
    assert.equal(res.body.htmlFailed, true);
    assert.equal(res.body.screenshotBase64, null);
    assert.equal(res.body.html, "");
  } finally {
    sessionManager.registry.delete(id);
  }
});
