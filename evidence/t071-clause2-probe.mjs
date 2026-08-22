// T-071 clause 2: separate "this account is rate-limited/degraded" from
// "copilot's image path specifically broke" — a text-only turn, a
// cooldownManager read, and a DOM sweep for any visible quota/limit
// messaging near the composer.
// T-083: was a hand-rolled `fetch(.../api/ping)` here; source changed to
// the shared helper (this file's own already-committed transcript,
// evidence/t071-clause2-transcript.txt, is untouched).
import { fetchServerProvenance } from "../scripts/serverProvenance.mjs";
import { pathToFileURL } from "node:url";

const BASE = "http://127.0.0.1:3333";

// T-095: pulled out of `main()` so a test can pin the SHAPE THAT ACTUALLY
// GETS PRINTED (and lands in this file's committed transcript) — see
// t075-repro.mjs's buildPingASummary for why this is a different
// guarantee than tests/serverProvenance.test.js already covers.
export function buildStatusLine(provenance, copilotStatus) {
  return { serverProvenance: provenance, copilot: copilotStatus };
}

async function main() {
  console.log("=== cooldownManager state (via /api/ping) ===");
  const provenance = await fetchServerProvenance(BASE);
  const providers = await fetch(`${BASE}/api/ping`).then((r) => r.json());
  console.log(
    JSON.stringify(buildStatusLine(provenance, providers.providers.copilot)),
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

// T-095: guarded so tests/evidenceProvenanceShape.test.js can import
// buildStatusLine above without triggering this file's live probe as a
// side effect of the import. Not re-run by this ticket (T-071 is a closed
// ticket — its committed evidence/t071-clause2-transcript.txt stays as the
// historical record).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  });
}
