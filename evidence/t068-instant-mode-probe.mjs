// T-068 clause 3: does deepseek's Instant mode ever INVENT a count for an
// attached image, or does it reliably say SEES=no? Bypasses
// sendPromptWithFile entirely (which now unconditionally selects Vision —
// T-048's own fix) by driving the page directly via
// POST /api/sessions/:id/evaluate: attach the file via a synthetic
// DataTransfer (no Playwright, no src/ change), type the prompt, click
// send, poll for the reply. Mode is left at whatever a fresh session
// defaults to (confirmed live: "Instant").
import {
  renderPng,
  COLORS,
  classify,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "file:///C:/Users/Work/browser-ai-bridge/scripts/vision-probe.mjs";

const BASE = "http://127.0.0.1:3333";

async function evaluate(sessionId, script) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script }),
  });
  return res.json();
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

async function main() {
  const truth = { count: 7, color: "goldenrod" };
  const png = renderPng(
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    truth.count,
    COLORS[truth.color],
  );
  const b64 = png.toString("base64");
  const prompt = buildPrompt(truth);

  console.log("=== create deepseek session ===");
  const c = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek" }),
  }).then((r) => r.json());
  console.log(JSON.stringify(c));
  if (!c.sessionId) return console.log("SESSION CREATE FAILED");
  const sid = c.sessionId;

  console.log("\n=== confirm mode is Instant (untouched) ===");
  const modeCheck = await evaluate(
    sid,
    `const radios = Array.from(document.querySelectorAll('[role="radiogroup"] [role="radio"]')); return radios.map(r => ({text:(r.textContent||"").trim(), checked:r.getAttribute("aria-checked")}));`,
  );
  console.log(JSON.stringify(modeCheck));

  console.log("\n=== attach image via synthetic DataTransfer ===");
  const attachScript = `
    const b64 = ${JSON.stringify(b64)};
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], "probe.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]');
    if (!input) return { found: false };
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { found: true };
  `;
  console.log(JSON.stringify(await evaluate(sid, attachScript)));

  await new Promise((r) => setTimeout(r, 3000));
  console.log("\n=== check for attachment evidence ===");
  console.log(
    JSON.stringify(
      await evaluate(
        sid,
        `return document.querySelectorAll('img[src^="blob:" i], [class*="attachment" i], [class*="thumbnail" i]').length;`,
      ),
    ),
  );

  console.log("\n=== type prompt into textarea ===");
  const typeScript = `
    const ta = document.querySelector('textarea[placeholder*="Message DeepSeek" i], textarea[placeholder*="DeepSeek" i], textarea.ds-scroll-area, #chat-input');
    if (!ta) return { found: false };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return { found: true, value: ta.value.slice(0, 50) };
  `;
  console.log(JSON.stringify(await evaluate(sid, typeScript)));

  await new Promise((r) => setTimeout(r, 500));
  console.log("\n=== click send ===");
  const sendScript = `
    const btn = document.querySelector('div[role="button"].ds-button--circle.ds-button--primary');
    if (!btn) return { found: false };
    if (btn.className.includes("ds-button--disabled")) return { found: true, disabled: true };
    const r = btn.getBoundingClientRect();
    const opts = {bubbles:true, cancelable:true, view:window, clientX:r.x+r.width/2, clientY:r.y+r.height/2};
    btn.dispatchEvent(new PointerEvent("pointerdown", opts));
    btn.dispatchEvent(new MouseEvent("mousedown", opts));
    btn.dispatchEvent(new PointerEvent("pointerup", opts));
    btn.dispatchEvent(new MouseEvent("mouseup", opts));
    btn.dispatchEvent(new MouseEvent("click", opts));
    return { found: true };
  `;
  console.log(JSON.stringify(await evaluate(sid, sendScript)));

  await new Promise((r) => setTimeout(r, 2000));
  console.log("\n=== diagnostic: did the message actually submit? ===");
  console.log(
    JSON.stringify(
      await evaluate(
        sid,
        `return { taValue: (document.querySelector('textarea[placeholder*="Message DeepSeek" i], textarea[placeholder*="DeepSeek" i], textarea.ds-scroll-area, #chat-input')||{}).value, markdownBlocks: document.querySelectorAll('.ds-markdown').length, anyMessageEls: document.querySelectorAll('[class*="message" i]').length };`,
      ),
    ),
  );

  console.log("\n=== polling for response (up to 90s) ===");
  const deadline = Date.now() + 90000;
  let lastText = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await evaluate(
      sid,
      `const blocks = document.querySelectorAll('.ds-markdown'); const last = blocks[blocks.length-1]; return { count: blocks.length, text: last ? last.textContent.trim() : "" };`,
    );
    const text = r?.result?.text || "";
    process.stdout.write(`.`);
    if (text && text === lastText) {
      stableCount++;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
    }
    lastText = text;
  }
  console.log(`\nfinal text: ${JSON.stringify(lastText)}`);
  console.log("truth:", JSON.stringify(truth));
  if (lastText) {
    console.log("classify:", JSON.stringify(classify(lastText, truth)));
  }

  console.log("\n=== NOT cleaning up — session left open for inspection ===");
  console.log("sessionId:", sid);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
