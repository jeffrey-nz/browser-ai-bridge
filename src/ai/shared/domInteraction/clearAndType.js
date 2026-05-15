import process from "node:process";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

function getModifier() {
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function safeFocus(locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true }).catch(() => {});
  await locator.focus().catch(() => {});
}

async function evalSetValue(locator, value) {
  return await locator
    .evaluate((el, v) => {
      try {
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          el.value = v;
          return true;
        }
        if (el.isContentEditable) {
          el.innerText = v;
          return true;
        }
      } catch {}
      return false;
    }, value)
    .catch(() => false);
}

async function evalDispatchEvents(locator) {
  await locator
    .evaluate((el) => {
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      } catch {}
    })
    .catch(() => {});
}

async function readValue(locator) {
  return await locator
    .evaluate((el) => {
      const t = el.value ?? el.innerText ?? el.textContent ?? "";
      return String(t)
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
    })
    .catch(() => "");
}

export async function clearAndType(page, inputBoxLocator, text, options = {}) {
  const {
    triggerEvents = true,
    chunkSize = 20000,
    useEvalClear = false,
    useClipboard = true,
    verify = true,
    maxVerifyWaitMs = 2000,
  } = options;

  const payload = typeof text === "string" ? text : String(text ?? "");
  const modifier = getModifier();

  await safeFocus(inputBoxLocator);

  let cleared = false;
  try {
    if (useEvalClear) {
      cleared = await evalSetValue(inputBoxLocator, "");
      if (cleared && triggerEvents) await evalDispatchEvents(inputBoxLocator);
    }
    if (!cleared) {
      await page.keyboard.press(`${modifier}+A`).catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      await page.waitForTimeout(120);
      cleared = true;
    }
  } catch {}

  let injected = false;

  // Strategy 0 — Playwright .fill() on plain TEXTAREA/INPUT.
  // Most reliable for React-controlled textareas (Copilot's composer) because
  // Playwright dispatches the same input events the page is listening for.
  // It's also atomic — no partial-paste failures.
  try {
    const isPlainTextarea = await inputBoxLocator
      .evaluate(
        (el) =>
          el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text"),
      )
      .catch(() => false);
    if (isPlainTextarea) {
      await inputBoxLocator.fill(payload, { timeout: 8000 });
      // .fill() auto-clears first, so this also satisfies the clear step.
      await page.waitForTimeout(200);
      const afterFill = await readValue(inputBoxLocator);
      if (afterFill.length >= Math.min(payload.length, 50)) {
        injected = true;
      }
    }
  } catch {}

  if (!injected && useClipboard) {
    try {
      const context = page.context();
      await context
        .grantPermissions(["clipboard-read", "clipboard-write"])
        .catch(() => {});

      const clipboardReady = await page.evaluate(async (txt) => {
        try {
          await navigator.clipboard.writeText(txt);
          return true;
        } catch {
          return false;
        }
      }, payload);

      if (clipboardReady) {
        await page.keyboard.press(`${modifier}+V`).catch(() => {});
        const waitTime =
          payload.length > 90000 ? 4500 : payload.length > 40000 ? 1800 : 500;
        await page.waitForTimeout(waitTime);
        // Verify the paste actually landed — clipboard paste silently fails
        // in offscreen-window mode (page not focused) and on some controlled
        // editors that swallow paste events. Don't claim success blindly.
        const afterPaste = await readValue(inputBoxLocator);
        if (afterPaste.length > 0) injected = true;
      }
    } catch {}
  }

  if (!injected) {
    try {
      const setOk = await evalSetValue(inputBoxLocator, payload);
      if (setOk) {
        if (triggerEvents) await evalDispatchEvents(inputBoxLocator);
        await page.waitForTimeout(400);
        const afterEval = await readValue(inputBoxLocator);
        if (afterEval.length > 0) injected = true;
      }
    } catch {}
  }

  if (!injected) {
    // Last-resort: keyboard.insertText is what Playwright uses internally for
    // page.fill() — works for React-controlled editors that ignore raw value
    // assignment because it dispatches synthetic InputEvent through the real
    // input handler chain.
    const size = Number.isFinite(Number(chunkSize))
      ? Math.max(1, Number(chunkSize))
      : 20000;
    for (let i = 0; i < payload.length; i += size) {
      await page.keyboard.insertText(payload.slice(i, i + size));
      await page.waitForTimeout(80);
    }
    injected = true;
  }

  if (triggerEvents) {
    await evalDispatchEvents(inputBoxLocator);
  }

  if (!verify) return;

  const start = Date.now();
  let current = await readValue(inputBoxLocator);

  while (
    Date.now() - start < maxVerifyWaitMs &&
    current.length === 0 &&
    payload.length > 0
  ) {
    await page.waitForTimeout(150);
    current = await readValue(inputBoxLocator);
  }

  if (payload.trim().length > 0 && current.length === 0) {
    log(colors.yellow("  (Injection verification failed: input still empty)"));
  }
}
