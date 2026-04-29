import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/server.js";

test.describe("POST /api/ask", () => {
  test("returns 400 if provider is missing", async () => {
    const response = await request(app)
      .post("/api/ask")
      .send({ prompt: "Hello!" });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Missing provider or sessionId/);
  });

  test("returns 400 if prompt is missing", async () => {
    const response = await request(app)
      .post("/api/ask")
      .send({ provider: "chatgpt" });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Missing prompt/);
  });

  test("returns 400 if provider is unknown", async () => {
    const response = await request(app)
      .post("/api/ask")
      .send({ provider: "skynet", prompt: "Hello!" });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Unknown provider specified: skynet/);
  });
});
