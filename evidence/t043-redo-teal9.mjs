// T-043 redo: the actual hard-case pair — copilot, count=9, colour TEAL
// (T-050's own fixture, pair-teal-9.png sha256 4162808b) — not indigo.
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

async function askOnce(providerId, truth, label) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providers: [providerId],
      prompt: buildPrompt(truth),
      images: [makeImage(truth.count, truth.color)],
      label,
    }),
    signal: AbortSignal.timeout(280000),
  });
  const elapsedMs = Date.now() - started;
  const json = await res.json().catch(() => ({}));
  const raw = json?.response ?? null;
  const g = raw ? classify(raw, truth) : { shape: "ERROR" };
  return {
    providerId,
    label,
    truth,
    httpStatus: res.status,
    elapsedMs,
    imageAttached: json?.imageAttached,
    raw,
    shape: g.shape,
    countOk: g.countOk,
    colorOk: g.colorOk,
  };
}

async function main() {
  const truth = { count: 9, color: "teal" };
  for (const [conditionLabel, label] of [
    ["constraint-OFF", "API Turn: T-043 control"],
    ["constraint-ON", "vision-probe"],
  ]) {
    console.log(
      `\n=== copilot truth=${JSON.stringify(truth)} ${conditionLabel} ===`,
    );
    const r = await askOnce("copilot", truth, label);
    console.log(JSON.stringify(r));
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
