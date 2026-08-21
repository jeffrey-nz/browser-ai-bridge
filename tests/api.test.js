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

test.describe("POST /api/ask-all", () => {
  test("returns 400 if prompt is missing", async () => {
    const response = await request(app)
      .post("/api/ask-all")
      .send({ providers: ["chatgpt", "gemini"] });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Missing prompt/);
  });

  test("returns 400 if providers is missing", async () => {
    const response = await request(app)
      .post("/api/ask-all")
      .send({ prompt: "Hello!" });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /providers must be a non-empty array/);
  });

  test("returns 400 if providers is an empty array", async () => {
    const response = await request(app)
      .post("/api/ask-all")
      .send({ prompt: "Hello!", providers: [] });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /providers must be a non-empty array/);
  });

  test("returns 400 if any provider is unknown", async () => {
    const response = await request(app)
      .post("/api/ask-all")
      .send({ prompt: "Hello!", providers: ["chatgpt", "skynet"] });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Unknown provider\(s\): skynet/);
  });
});
