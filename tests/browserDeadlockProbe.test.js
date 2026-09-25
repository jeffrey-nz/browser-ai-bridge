import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * 2026-09-22: `getBrowserContext`'s health check raced its timeout against
 * `pages[0].evaluate(() => 1)` as well as `browser.version()`.
 *
 * `pages[0]` is whichever page happens to be first — often a provider tab
 * streaming a long answer — and a page whose JS thread is busy does not answer
 * `evaluate` until it is free. The race therefore timed out on a healthy
 * browser and took the hard-reset path, killing Chrome and every other
 * in-flight session with it. Measured during one long generation run: six hard
 * resets, each losing the turn in flight.
 *
 * These tests pin the shape of the fix without booting a browser: a hung PAGE
 * must not fail the check, while a hung CDP endpoint still must.
 */

// The decision the fixed code makes, extracted so it can be tested directly.
// Mirrors src/browser/context.js: the page probe has its own budget and cannot
// reject; only browser.version() is allowed to fail the race.
async function healthCheck({ pages, version, timeoutMs = 10000 }) {
  const pageProbeMs = Math.min(2000, Math.floor(timeoutMs / 2));
  const probeFirstPage = async () => {
    if (!pages.length) return;
    await Promise.race([
      pages[0]
        .evaluate(() => 1)
        .then(() => false)
        .catch(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), pageProbeMs)),
    ]);
  };
  await Promise.race([
    (async () => {
      await probeFirstPage();
      await version();
    })(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Browser JS thread or CDP deadlock")),
        timeoutMs,
      ),
    ),
  ]);
}

const neverResolves = () => new Promise(() => {});

test("a BUSY first page does not trigger a browser reset — the regression this fixes", async () => {
  // A provider tab mid-stream: evaluate() never comes back.
  const pages = [{ evaluate: neverResolves }];
  await assert.doesNotReject(
    () =>
      healthCheck({
        pages,
        version: async () => "Chrome/1.2.3",
        timeoutMs: 6000,
      }),
    "a hung page must not be reported as a dead browser",
  );
});

test("a dead CDP endpoint STILL triggers a reset — the check must not be defanged", async () => {
  const pages = [{ evaluate: async () => 1 }];
  await assert.rejects(
    () => healthCheck({ pages, version: neverResolves, timeoutMs: 300 }),
    /deadlock/i,
    "browser.version() hanging is a real deadlock and must still fail",
  );
});

test("both hung: the CDP endpoint is what decides, and it still fails", async () => {
  const pages = [{ evaluate: neverResolves }];
  await assert.rejects(
    () => healthCheck({ pages, version: neverResolves, timeoutMs: 300 }),
    /deadlock/i,
  );
});

test("a page that throws is tolerated exactly as before", async () => {
  const pages = [
    {
      evaluate: async () => {
        throw new Error("detached frame");
      },
    },
  ];
  await assert.doesNotReject(() =>
    healthCheck({
      pages,
      version: async () => "Chrome/1.2.3",
      timeoutMs: 6000,
    }),
  );
});

test("no pages at all is healthy as long as CDP answers", async () => {
  await assert.doesNotReject(() =>
    healthCheck({
      pages: [],
      version: async () => "Chrome/1.2.3",
      timeoutMs: 6000,
    }),
  );
});

test("the page probe is capped well under the overall budget, so it cannot consume it", () => {
  for (const timeoutMs of [10000, 6000, 3000, 1000]) {
    const pageProbeMs = Math.min(2000, Math.floor(timeoutMs / 2));
    assert.ok(
      pageProbeMs < timeoutMs,
      `page probe ${pageProbeMs}ms must be under the ${timeoutMs}ms budget`,
    );
    assert.ok(pageProbeMs <= 2000);
  }
});
