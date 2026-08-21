// T-067: interleaved copilot turns, teal-9 (T-050's hard fixture) vs
// crimson-4 (known-good control), same session, to decide whether
// imageAttached:true is a false positive on teal-9 or copilot genuinely
// answers SEES=no to that specific picture.
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

async function askOnce(sessionId, truth, turnLabel) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      prompt: buildPrompt(truth),
      images: [makeImage(truth.count, truth.color)],
      label: "API Turn: T-067 interleave",
    }),
    signal: AbortSignal.timeout(180000),
  });
  const elapsedMs = Date.now() - started;
  const json = await res.json().catch(() => ({}));
  const g = json?.response
    ? classify(json.response, truth)
    : { shape: "ERROR" };
  const row = {
    turnLabel,
    truth,
    httpStatus: res.status,
    elapsedMs,
    fullResponse: json,
    shape: g.shape,
    countOk: g.countOk,
    colorOk: g.colorOk,
  };
  console.log(`\n=== ${turnLabel}: ${JSON.stringify(truth)} ===`);
  console.log(JSON.stringify(row, null, 2));
  return row;
}

const TEAL9 = { count: 9, color: "teal" };
const CRIMSON4 = { count: 4, color: "crimson" };
// Interleaved order: teal, crimson, teal, crimson, teal, crimson (3 each).
const ORDER = [TEAL9, CRIMSON4, TEAL9, CRIMSON4, TEAL9, CRIMSON4];

async function main() {
  console.log("=== create copilot session ===");
  const c = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "copilot" }),
  }).then((r) => r.json());
  console.log(JSON.stringify(c));
  if (!c.sessionId) {
    console.log("SESSION CREATE FAILED — stopping.");
    return;
  }
  const sessionId = c.sessionId;

  const rows = [];
  for (let i = 0; i < ORDER.length; i++) {
    const truth = ORDER[i];
    const label = `turn${i + 1}-${truth.count}${truth.color[0]}`;
    rows.push(await askOnce(sessionId, truth, label));
  }

  console.log("\n\n=== SUMMARY ===");
  const byFixture = {};
  for (const r of rows) {
    const key = `${r.truth.count}/${r.truth.color}`;
    (byFixture[key] ??= []).push(r);
    console.log(
      `${r.turnLabel.padEnd(14)} ${key.padEnd(10)} shape=${r.shape} ` +
        `imageAttached=${r.fullResponse.imageAttached} ` +
        `evidence=${JSON.stringify(r.fullResponse.imageAttachedEvidence || null)}`,
    );
  }
  for (const key of Object.keys(byFixture)) {
    const rs = byFixture[key];
    const seesNo = rs.filter((r) => r.shape === "SEES_NO").length;
    console.log(`${key}: SEES_NO ${seesNo}/${rs.length}`);
  }

  console.log("\n=== cleanup ===");
  const del = await fetch(`${BASE}/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
  console.log("delete status", del.status);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
