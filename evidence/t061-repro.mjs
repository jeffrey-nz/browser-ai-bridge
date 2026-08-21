// T-061: does DELETE-then-POST on a recycled chatgpt session actually
// reset the visible conversation, or just hand back a stale counter?
const BASE = process.env.T061_BASE_URL || "http://127.0.0.1:3333";
const CONVERSATION_TURN_SELECTOR = '[data-testid^="conversation-turn-"]';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log("=== create session 1 ===");
  const c1 = await post("/api/sessions", { provider: "chatgpt" });
  console.log(JSON.stringify(c1));
  if (!c1.json.sessionId) {
    console.log("SESSION 1 CREATE FAILED — stopping.");
    return;
  }
  const id1 = c1.json.sessionId;

  console.log("\n=== seed turn on session 1 ===");
  const seed = await post("/api/ask", {
    sessionId: id1,
    prompt:
      "Reply with EXACTLY this text and nothing else: T061-SEED-MARKER",
    label: "API Turn: T-061 seed",
  });
  console.log(JSON.stringify(seed));

  console.log("\n=== DELETE session 1 ===");
  const delRes = await fetch(`${BASE}/api/sessions/${id1}`, {
    method: "DELETE",
  });
  console.log("delete status", delRes.status);

  console.log("\n=== create session 2 ===");
  const c2 = await post("/api/sessions", { provider: "chatgpt" });
  console.log(JSON.stringify(c2));
  if (!c2.json.sessionId) {
    console.log("SESSION 2 CREATE FAILED — stopping.");
    return;
  }
  const id2 = c2.json.sessionId;

  console.log("\n=== same id as session 1? ===");
  console.log("id1", id1, "id2", id2, "SAME:", id1 === id2);

  console.log(
    "\n=== DOM turn count on session 2, BEFORE sending anything ===",
  );
  const evalRes = await post(`/api/sessions/${id2}/evaluate`, {
    script: `return { turnCount: document.querySelectorAll(${JSON.stringify(CONVERSATION_TURN_SELECTOR)}).length, url: location.href };`,
  });
  console.log(JSON.stringify(evalRes));

  console.log("\n=== one turn on session 2 ===");
  const t2 = await post("/api/ask", {
    sessionId: id2,
    prompt:
      "Reply with EXACTLY this text and nothing else: T061-TURN2-MARKER",
    label: "API Turn: T-061 turn2",
  });
  console.log(JSON.stringify(t2));

  console.log("\n=== cleanup ===");
  const del2 = await fetch(`${BASE}/api/sessions/${id2}`, {
    method: "DELETE",
  });
  console.log("delete2 status", del2.status);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
