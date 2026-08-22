// T-071 clause 2: separate "this account is rate-limited/degraded" from
// "copilot's image path specifically broke" — a text-only turn, a
// cooldownManager read, and a DOM sweep for any visible quota/limit
// messaging near the composer.
// T-083: was a hand-rolled `fetch(.../api/ping)` here; source changed to
// the shared helper (this file's own already-committed transcript,
// evidence/t071-clause2-transcript.txt, is untouched).
import { fetchServerProvenance } from "../scripts/serverProvenance.mjs";

const BASE = "http://127.0.0.1:3333";

async function main() {
  console.log("=== cooldownManager state (via /api/ping) ===");
  const provenance = await fetchServerProvenance(BASE);
  const providers = await fetch(`${BASE}/api/ping`).then((r) => r.json());
  console.log(
    JSON.stringify({
      loadedCommit: provenance.loadedCommit,
      loadedTreeDirty: provenance.loadedTreeDirty,
      copilot: providers.providers.copilot,
    }),
  );

  console.log("\n=== text-only turn (no image) ===");
  const started = Date.now();
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providers: ["copilot"],
      prompt: "Reply with EXACTLY this text and nothing else: PONG-T071",
      label: "API Turn: T-071 text control",
    }),
    signal: AbortSignal.timeout(60000),
  });
  const elapsedMs = Date.now() - started;
  const json = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ elapsedMs, httpStatus: res.status, ...json }));

  console.log("\n=== DOM sweep for quota/limit messaging ===");
  const c = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "copilot" }),
  }).then((r) => r.json());
  console.log(JSON.stringify(c));
  if (c.sessionId) {
    const sweep = await fetch(`${BASE}/api/sessions/${c.sessionId}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script:
          'const texts = []; document.querySelectorAll("*").forEach(el => { if (el.children.length===0) { const t=(el.textContent||"").trim(); if (t && t.length<80 && /limit|quota|upgrade|plus|remaining|per day|per month|too many/i.test(t)) texts.push(t); }}); return [...new Set(texts)];',
      }),
    }).then((r) => r.json());
    console.log(JSON.stringify(sweep));
    const del = await fetch(`${BASE}/api/sessions/${c.sessionId}`, {
      method: "DELETE",
    });
    console.log("delete status", del.status);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
