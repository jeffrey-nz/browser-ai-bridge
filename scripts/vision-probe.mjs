#!/usr/bin/env node
/**
 * vision-probe.mjs — the falsifiable test for T-001.
 *
 * "Describe this image" passes even when no image ever arrived, because a
 * model will happily improvise a plausible-sounding description. This probe
 * asks a question ONLY the picture can answer: a random COUNT (3-9) of
 * solid-colour squares in a random named COLOR, freshly generated every run
 * — nothing an LLM could guess its way into (1-in-45 by chance, if it did).
 *
 * The image is a hand-rolled PNG (raw pixel buffer + zlib deflate, no font
 * or canvas library) so this script has no dependency beyond Node itself —
 * no browser needs to be installed to generate the fixture.
 *
 * It hits the running bridge server exactly as a real caller would — HTTP,
 * one provider pinned per request via `providers: [id]` — and classifies
 * every reply into one of:
 *
 *   PASS        correct COUNT and COLOR
 *   WRONG       answered SEES=yes but got the count and/or colour wrong —
 *               the model saw *something* and was confidently mistaken
 *               about it (this is not an upload bug and no upload fix will
 *               ever catch it — see Copilot's STAVES=2 finding on T-001)
 *   SEES_NO     the model explicitly said it saw no image
 *   ECHO        the reply looks like the prompt read back, not an answer
 *   NO_ANSWER   turn completed but the reply matched none of the expected
 *               shapes (garbled / off-format)
 *   ERROR       the HTTP call itself failed, or the server reported a
 *               non-2xx status, or the turn timed out
 *
 * It also prints the bridge's own `imageAttached` field next to the
 * classification, so a mismatch (imageAttached:true but SEES_NO, or
 * imageAttached:false but PASS) is visible at a glance — either would mean
 * the confirmation heuristic itself is wrong for that provider.
 *
 * Usage:
 *   node scripts/vision-probe.mjs                          # all providers, /api/ask
 *   node scripts/vision-probe.mjs --endpoint image-ask      # via /api/image-ask
 *   node scripts/vision-probe.mjs --providers gemini,copilot
 *   node scripts/vision-probe.mjs --base-url http://localhost:3333
 *   node scripts/vision-probe.mjs --break gemini             # see "Deliberate breakage" below
 *
 * Deliberate breakage (acceptance #3 — the test must be SEEN to fail):
 *   There is no env-var switch for this — breaking a provider's upload
 *   means editing its real selector (e.g. the `attachBtn` entry in
 *   src/ai/generic/specs.js, or a bespoke provider's uploadFileTo* selector)
 *   to something that cannot match, then starting a bridge instance on a
 *   spare port so the live server (and anyone else's sessions on it) is
 *   never touched, and running this probe against that instance with
 *   --providers pointed at just the broken one. `--break <providerId>`
 *   below only prints the exact steps — it does not edit code or start a
 *   server for you, so the failure is demonstrated deliberately.
 */

import zlib from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const ALL_PROVIDERS = [
  "chatgpt",
  "gemini",
  "deepseek",
  "grok",
  "copilot",
  "kimi",
  "qwen",
  "zai",
  "mistral",
  "perplexity",
];

const COLORS = {
  crimson: [220, 20, 60],
  teal: [0, 128, 128],
  goldenrod: [218, 165, 32],
  indigo: [75, 0, 130],
};

// --- Minimal PNG encoder: raw RGB buffer -> .png bytes, no dependencies. ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** width x height white canvas with `count` solid squares of `rgb` in a row. */
function renderPng(width, height, count, rgb) {
  const px = Buffer.alloc(width * height * 3, 255); // white background
  const square = 80;
  const gap = 30;
  const totalW = count * square + (count - 1) * gap;
  const startX = Math.round((width - totalW) / 2);
  const y0 = Math.round((height - square) / 2);
  for (let i = 0; i < count; i++) {
    const x0 = startX + i * (square + gap);
    for (let y = y0; y < y0 + square; y++) {
      for (let x = x0; x < x0 + square; x++) {
        const idx = (y * width + x) * 3;
        px[idx] = rgb[0];
        px[idx + 1] = rgb[1];
        px[idx + 2] = rgb[2];
      }
    }
  }

  // Raw scanlines, each prefixed with filter-type byte 0 (None).
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idatData = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseArgs(argv) {
  const out = {
    endpoint: "ask",
    baseUrl: process.env.VISION_PROBE_BASE_URL || "http://localhost:3333",
    providers: null,
    timeoutMs: 300000,
    label: "vision-probe",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--endpoint") out.endpoint = argv[++i];
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--providers")
      out.providers = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--break") out.breakProvider = argv[++i];
    else if (a === "--image") out.image = argv[++i];
    else if (a === "--count") out.count = Number(argv[++i]);
    else if (a === "--color") out.color = argv[++i];
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (!out.providers) out.providers = ALL_PROVIDERS;
  return out;
}

/** Fresh PNG fixture: `count` (3-9) solid squares in a row, colour named. */
async function generateTestImage() {
  const count = 3 + Math.floor(Math.random() * 7);
  const colorNames = Object.keys(COLORS);
  const color = colorNames[Math.floor(Math.random() * colorNames.length)];
  const png = renderPng(900, 400, count, COLORS[color]);

  const outDir = join(REPO_ROOT, "reports", "vision-probe");
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `probe-${Date.now()}.png`);
  await writeFile(path, png);
  return { path, count, color };
}

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

function classify(replyText, truth) {
  const text = (replyText || "").trim();
  const seesNo = /\bSEES\s*=\s*no\b/i.test(text);
  if (seesNo) return { shape: "SEES_NO" };

  const m = text.match(
    /SEES\s*=\s*yes[\s\S]*?COUNT\s*=\s*(\d+)[\s\S]*?COLOR\s*=\s*([a-zA-Z]+)/i,
  );
  if (m) {
    const [, count, color] = m;
    const countOk = Number(count) === truth.count;
    const colorOk = color.toLowerCase() === truth.color.toLowerCase();
    if (countOk && colorOk) return { shape: "PASS" };
    return {
      shape: "WRONG",
      detail: `got COUNT=${count} COLOR=${color}, expected COUNT=${truth.count} COLOR=${truth.color}`,
    };
  }

  // Prompt-echo: the reply contains a large fraction of the prompt's own
  // distinctive wording rather than an answer shaped like one.
  if (/Look at the attached image ONLY/i.test(text) && text.length > 80) {
    return { shape: "ECHO" };
  }

  if (!text) return { shape: "NO_ANSWER", detail: "empty response" };
  return { shape: "NO_ANSWER", detail: text.slice(0, 200) };
}

async function askProvider(opts, providerId, imagePath, truth) {
  const prompt = buildPrompt(truth);
  const started = Date.now();

  let body;
  let url;
  if (opts.endpoint === "image-ask") {
    url = `${opts.baseUrl}/api/image-ask`;
    body = { provider: providerId, prompt, imagePath, label: opts.label };
  } else {
    const imageBuf = await (
      await import("node:fs/promises")
    ).readFile(imagePath);
    url = `${opts.baseUrl}/api/ask`;
    body = {
      providers: [providerId],
      prompt,
      images: [`data:image/png;base64,${imageBuf.toString("base64")}`],
      label: opts.label,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        providerId,
        elapsedMs,
        shape: "ERROR",
        detail: `HTTP ${res.status}: ${json?.error || "(no error field)"}`,
        imageAttached: json?.imageAttached,
      };
    }
    const cls = classify(json.response, truth);
    return {
      providerId,
      elapsedMs,
      ...cls,
      imageAttached: json.imageAttached,
      warning: json.warning,
      raw: json.response,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      providerId,
      elapsedMs,
      shape: "ERROR",
      detail: err.name === "AbortError" ? "timeout" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "Usage: node scripts/vision-probe.mjs [--endpoint ask|image-ask] [--providers a,b,c] " +
        "[--base-url url] [--timeout-ms N] [--image path --count N --color name] [--out path]",
    );
    return;
  }

  if (opts.breakProvider) {
    console.log(
      `--break does not edit code or start a server — see the file header for why.\n` +
        `To demonstrate ${opts.breakProvider} failing on purpose:\n\n` +
        `  1. Edit its attach-button selector (src/ai/generic/specs.js for a generic\n` +
        `     provider, or the bespoke uploadFileTo* selector otherwise) to something\n` +
        `     that cannot match, e.g. "input[type='file'].NONEXISTENT-PROBE-BREAK".\n` +
        `  2. Start a bridge instance on a spare port so the live server (and\n` +
        `     anyone else's sessions on it) is never touched:\n` +
        `       PORT=3334 node --env-file=.env src/index.js\n` +
        `  3. Re-run this probe against just that instance and provider:\n` +
        `       node scripts/vision-probe.mjs --base-url http://localhost:3334 --providers ${opts.breakProvider}\n` +
        `  4. Revert the selector edit and stop the spare instance.\n`,
    );
    return;
  }

  let imagePath, count, color;
  if (opts.image && opts.count && opts.color) {
    // Reuse a fixture generated by an earlier invocation — lets several
    // single-provider runs (launched in parallel, one process each, to stay
    // under a single run's wall-clock budget) all be asked about the exact
    // same picture, as one measurement rather than several.
    ({ image: imagePath, count, color } = opts);
    console.log(
      `Using existing test image (endpoint: /api/${opts.endpoint})...`,
    );
  } else {
    console.log(`Generating test image (endpoint: /api/${opts.endpoint})...`);
    ({ path: imagePath, count, color } = await generateTestImage());
  }
  console.log(`  ground truth: COUNT=${count} COLOR=${color}`);
  console.log(`  image: ${imagePath}\n`);

  const results = [];
  for (const providerId of opts.providers) {
    process.stdout.write(`${providerId.padEnd(12)} ... `);
    const r = await askProvider(opts, providerId, imagePath, { count, color });
    results.push(r);
    const secs = (r.elapsedMs / 1000).toFixed(0) + "s";
    const attached =
      r.imageAttached === undefined
        ? "?"
        : r.imageAttached
          ? "attached"
          : "NOT attached";
    console.log(
      `${r.shape.padEnd(9)} ${secs.padStart(5)}  imageAttached=${attached}  ${r.detail || ""}`,
    );
  }

  const counts = results.reduce((acc, r) => {
    acc[r.shape] = (acc[r.shape] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `\n${results.filter((r) => r.shape === "PASS").length} of ${results.length} PASS. ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );

  const outDir = join(REPO_ROOT, "reports", "vision-probe");
  await mkdir(outDir, { recursive: true });
  const outPath = opts.outPath || join(outDir, `run-${Date.now()}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      { endpoint: opts.endpoint, truth: { count, color }, imagePath, results },
      null,
      2,
    ),
  );
  console.log(`\nFull results written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
