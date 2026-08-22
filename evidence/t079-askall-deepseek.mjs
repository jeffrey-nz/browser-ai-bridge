// T-079: live proof through /api/ask-all specifically — vision-probe.mjs's
// askProvider() only ever POSTs to /api/ask or /api/image-ask (scripts/
// vision-probe.mjs:766-780), never /api/ask-all, so it cannot drive the
// fan-out endpoint this ticket is actually about without a change to
// vision-probe.mjs itself, which is out of scope here. Per the ticket's own
// fallback clause: committing the raw /api/ask-all response JSON instead of
// switching the proof back to /api/ask.
//
// Reuses vision-probe.mjs's own renderPng/COLORS (a pure function of
// count+colour — T-074) so this fixture is the same kind of pinned stimulus
// every other vision-probe evidence file in this repo uses, and its own
// buildPrompt() text (not exported, so duplicated here verbatim).
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  renderPng,
  COLORS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "../scripts/vision-probe.mjs";
// T-083: was a hand-rolled `fetch(.../api/ping)` here — the exact shape
// evidence/t075-repro.mjs's own hand-rolled version disagreed with. Source
// changed to the shared helper; this file's own already-committed output
// (reports/vision-probe/t079-askall-deepseek.json) is untouched.
import { fetchServerProvenance } from "../scripts/serverProvenance.mjs";

const BASE_URL = process.env.BRIDGE_URL || "http://localhost:3333";
const COUNT = 4;
const COLOR = "goldenrod";
const FIXTURE_PATH = new URL(
  "../reports/vision-probe/t079-askall-fixture.png",
  import.meta.url,
);
const REPORT_PATH = new URL(
  "../reports/vision-probe/t079-askall-deepseek.json",
  import.meta.url,
);

function buildPrompt() {
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

// T-095: pulled out of `main()` so a test can pin the SHAPE THAT ACTUALLY
// GETS WRITTEN into the committed record — see t075-repro.mjs's
// buildPingASummary for why this is a different guarantee than
// tests/serverProvenance.test.js already covers.
export function buildRecord({
  bridgeCommit,
  provenance,
  truth,
  fixtureSha256,
  httpStatus,
  elapsedMs,
  raw,
}) {
  return {
    endpoint: "/api/ask-all",
    bridgeCommit,
    serverProvenance: provenance,
    truth,
    fixtureSha256,
    httpStatus,
    elapsedMs,
    raw,
  };
}

async function main() {
  const provenance = await fetchServerProvenance(BASE_URL);
  console.log(
    `[provenance] loadedCommit=${provenance.loadedCommit} loadedTreeDirty=${provenance.loadedTreeDirty}`,
  );

  const png = renderPng(CANVAS_WIDTH, CANVAS_HEIGHT, COUNT, COLORS[COLOR]);
  await writeFile(FIXTURE_PATH, png);
  const fixtureSha256 = createHash("sha256")
    .update(await readFile(FIXTURE_PATH))
    .digest("hex");
  console.log(
    `[fixture] count=${COUNT} color=${COLOR} fixtureSha256=${fixtureSha256}`,
  );

  const body = {
    providers: ["deepseek"],
    prompt: buildPrompt(),
    images: [`data:image/png;base64,${png.toString("base64")}`],
    label: "T-079 ask-all deepseek visionModeVerdict proof",
  };

  const started = Date.now();
  const res = await fetch(`${BASE_URL}/api/ask-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - started;
  const json = await res.json();
  console.log(`[ask-all] HTTP ${res.status} in ${elapsedMs}ms`);
  console.log(JSON.stringify(json, null, 2));

  const record = buildRecord({
    bridgeCommit: process.env.T079_BRIDGE_COMMIT || null,
    provenance,
    truth: { count: COUNT, color: COLOR },
    fixtureSha256,
    httpStatus: res.status,
    elapsedMs,
    raw: json,
  });
  await writeFile(REPORT_PATH, JSON.stringify(record, null, 2));
  console.log(`[written] ${REPORT_PATH.pathname}`);

  const deepseekRow = json?.answers?.find((a) => a.provider === "deepseek");
  console.log(
    `[result] deepseek row visionModeVerdict=${deepseekRow?.visionModeVerdict} imageAttached=${deepseekRow?.imageAttached}`,
  );
}

// T-095: guarded so tests/evidenceProvenanceShape.test.js can import
// buildRecord above without triggering this file's live /api/ask-all call
// as a side effect of the import. Not re-run by this ticket (T-079 is a
// closed ticket — its committed reports/vision-probe/t079-askall-deepseek.json
// stays as the historical record).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  });
}
