// T-043: does the pre-T-041 constraint injection (any label not starting
// "API Turn") change gemini/copilot's vision-probe accuracy, at a PINNED
// fixture (T-050's warning — copilot's verdict is decided by the drawn
// COUNT alone, so the fixture must be held constant across both arms or
// the constraint's own effect is confounded with which picture was drawn).
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
    signal: AbortSignal.timeout(180000),
  });
  const elapsedMs = Date.now() - started;
  const json = await res.json().catch(() => ({}));
  const raw = json?.results?.[0]?.response ?? json?.response ?? null;
  const g = raw ? classify(raw, truth) : { shape: "ERROR" };
  return {
    providerId,
    label,
    truth,
    httpStatus: res.status,
    elapsedMs,
    imageAttached: json?.results?.[0]?.imageAttached ?? json?.imageAttached,
    raw,
    shape: g.shape,
    countOk: g.countOk,
    colorOk: g.colorOk,
    fullResponse: json,
  };
}

const CASES = [
  // gemini: T-050 found it stable at both counts, so one pinned fixture
  // suffices to isolate the constraint's own effect.
  { providerId: "gemini", truth: { count: 4, color: "crimson" } },
  // copilot: T-050 found the FIXTURE COUNT alone flips its verdict
  // (0/3 at count=9, 3/3 at count=4) — pin BOTH, same two counts T-050
  // used, so a difference between arms can't be explained by count drift.
  { providerId: "copilot", truth: { count: 4, color: "crimson" } },
  { providerId: "copilot", truth: { count: 9, color: "indigo" } },
];

async function main() {
  const results = [];
  for (const { providerId, truth } of CASES) {
    for (const [conditionLabel, label] of [
      ["constraint-OFF", "API Turn: T-043 control"],
      ["constraint-ON", "vision-probe"], // bare label, pre-T-041 shape
    ]) {
      console.log(
        `\n=== ${providerId} truth=${JSON.stringify(truth)} ${conditionLabel} ===`,
      );
      const r = await askOnce(providerId, truth, label);
      const { fullResponse, ...printable } = r;
      console.log(JSON.stringify(printable));
      results.push({ condition: conditionLabel, ...r });
    }
  }

  console.log("\n\n=== SUMMARY ===");
  for (const r of results) {
    console.log(
      `${r.providerId.padEnd(8)} count=${r.truth.count} ${r.condition.padEnd(16)} ` +
        `shape=${r.shape} countOk=${r.countOk} colorOk=${r.colorOk} ` +
        `imageAttached=${r.imageAttached} elapsedMs=${r.elapsedMs}`,
    );
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
