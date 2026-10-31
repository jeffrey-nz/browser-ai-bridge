import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromeAnswers } from "../src/browser/connection.js";

// 2026-10-31: two seconds without a CDP connection read as "no Chrome", and the launch that
// followed killed a shared browser. The port is asked first, and only silence means no Chrome.
test("a slow browser still answers, and nothing listening does not", async () => {
  const server = http.createServer((req, res) => {
    setTimeout(() => res.end(JSON.stringify({ Browser: "Chrome" })), 2500);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  assert.equal(await chromeAnswers(`http://127.0.0.1:${port}`), true);
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await chromeAnswers(`http://127.0.0.1:${port}`, 500), false);
});
