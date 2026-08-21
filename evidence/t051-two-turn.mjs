// T-051: two-turn same-session probe against a live chatgpt session.
// Not a repo script — throwaway orchestration for one ticket's evidence.
import {
  renderPng,
  COLORS,
  classify,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "file:///C:/Users/Work/browser-ai-bridge/scripts/vision-probe.mjs";

const BASE = "http://127.0.0.1:3333";

function buildPrompt(truth) {
  const palette = Object.keys(COLORS).join(", ");
  return (
    `Look at the attached image ONLY — do not guess. Reply with EXACTLY one line, ` +
    `no other text:\n\n` +
    `SEES=yes COUNT=<how many solid-colour squares are shown> COLOR=<pick the closest ` +
    `match from exactly this list: ${palette}>\n\n` +
    `...or reply with EXACTLY this if you cannot see any image at all:\n\n` +
    `SEES=no`
  );
}

function makeImage(count, color) {
  const png = renderPng(CANVAS_WIDTH, CANVAS_HEIGHT, count, COLORS[color]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const CHATGPT_EVIDENCE_SELECTOR =
  'img[src^="blob:" i], [class*="attachment" i], [class*="thumbnail" i], ' +
  '[aria-label*="attachment" i], [aria-label^="Attachment" i], ' +
  '[data-testid*="attachment" i], [class*="file-preview" i], [class*="filePreview" i], ' +
  'button[aria-label*="uploaded image" i], img[src*="backend-api/estuary" i], img[src*="backend-api/files" i]';

async function main() {
  console.log("=== T-051: create session ===");
  const createRes = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "chatgpt" }),
  });
  const createJson = await createRes.json();
  console.log(JSON.stringify(createJson));
  if (!createRes.ok) {
    console.log("SESSION CREATE FAILED — stopping.");
    return;
  }
  const sessionId = createJson.sessionId;

  const truth1 = { count: 4, color: "crimson" };
  const truth2 = { count: 6, color: "indigo" };

  console.log("\n=== T-051 turn 1 ===");
  console.log("truth1", truth1);
  const t1started = Date.now();
  const res1 = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      prompt: buildPrompt(truth1),
      images: [makeImage(truth1.count, truth1.color)],
      label: "API Turn: T-051 turn1",
    }),
    signal: AbortSignal.timeout(120000),
  });
  const json1 = await res1.json().catch(() => ({}));
  console.log("elapsedMs", Date.now() - t1started, "http", res1.status);
  console.log(JSON.stringify(json1));
  if (json1?.reply) {
    console.log("classify1", JSON.stringify(classify(json1.reply, truth1)));
  }

  console.log(
    "\n=== T-051: DOM check RIGHT BEFORE turn 2's own upload starts ===",
  );
  const evalRes = await fetch(`${BASE}/api/sessions/${sessionId}/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      script: `return document.querySelectorAll(${JSON.stringify(CHATGPT_EVIDENCE_SELECTOR)}).length;`,
    }),
  });
  const evalJson = await evalRes.json().catch(() => ({}));
  console.log(JSON.stringify(evalJson));

  console.log("\n=== T-051 turn 2 (same sessionId, no new-chat) ===");
  console.log("truth2", truth2);
  const t2started = Date.now();
  const res2 = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      prompt: buildPrompt(truth2),
      images: [makeImage(truth2.count, truth2.color)],
      label: "API Turn: T-051 turn2",
    }),
    signal: AbortSignal.timeout(120000),
  });
  const json2 = await res2.json().catch(() => ({}));
  console.log("elapsedMs", Date.now() - t2started, "http", res2.status);
  console.log(JSON.stringify(json2));
  if (json2?.reply) {
    console.log("classify2", JSON.stringify(classify(json2.reply, truth2)));
  }

  console.log("\n=== T-051: cleanup ===");
  const delRes = await fetch(`${BASE}/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
  console.log("delete status", delRes.status);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
