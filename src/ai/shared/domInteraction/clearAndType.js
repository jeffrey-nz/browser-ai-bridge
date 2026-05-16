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
        // React 16+ tracks the last-synced value internally. Direct el.value = x
        // or el.innerText = x won't trigger onChange unless we go through the
        // native prototype setter, which bypasses React's value intercept.
        // This is the "nativeInputValueSetter" technique widely used for React inputs.
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(el),
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(el, el.value); // re-set via native setter to untrack React's old value
          }
        } else if (el.isContentEditable) {
          // ProseMirror / contenteditable: dispatch an InputEvent with the
          // data attribute set so React (and ProseMirror) see a real keystroke.
          el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }));
        }
        el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }));
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

  // Detect whether the target is a contenteditable element (ProseMirror / rich-text
  // editors like ChatGPT's composer). These editors only accept text via real keyboard
  // events — direct value assignment and clipboard paste both bypass ProseMirror's
  // internal transaction system, leaving the editor's internal state empty (send button
  // stays disabled). For contenteditable we skip straight to keyboard.insertText below.
  const isContentEditable = await inputBoxLocator
    .evaluate((el) => el.isContentEditable === true)
    .catch(() => false);

  // Strategy 0 — Playwright .fill() on plain TEXTAREA/INPUT.
  // Most reliable for React-controlled textareas (Copilot's composer) because
  // Playwright dispatches the same input events the page is listening for.
  // It's also atomic — no partial-paste failures.
  // Skip for contenteditable (ProseMirror) — .fill() doesn't update editor state.
  if (!isContentEditable) {
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
  }

  // Strategy 1 — Clipboard paste (Ctrl/Cmd+V).
  // Works for most editors but NOT for ProseMirror contenteditable: paste via
  // keyboard shortcut doesn't dispatch the synthetic paste event ProseMirror listens
  // for in a headless browser, leaving editor state empty despite DOM showing text.
  // Skip for contenteditable to avoid false-positive injected=true via readValue.
  if (!injected && !isContentEditable && useClipboard) {
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

  // Strategy 2 — direct DOM value assignment + event dispatch.
  // Skip for contenteditable (ProseMirror): el.innerText = v sets the DOM but not
  // ProseMirror's internal state, and readValue would report non-empty via innerText,
  // falsely setting injected=true and blocking Strategy 3 (keyboard.insertText).
  if (!injected && !isContentEditable) {
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
    // For contenteditable / ProseMirror editors: document.execCommand('insertText')
    // fires the correct browser-native input events including InputEvent with
    // inputType="insertText", which ProseMirror's input handler processes correctly.
    // keyboard.insertText only dispatches a synthetic input event that ProseMirror
    // may not handle in all configurations. execCommand goes through the real
    // browser text insertion path (same as human typing).
    if (isContentEditable) {
      // Insert in chunks to avoid browser limits on execCommand size (~100KB)
      const chunkBytes = 50000;
      for (let i = 0; i < payload.length; i += chunkBytes) {
        const chunk = payload.slice(i, i + chunkBytes);
        const ok = await inputBoxLocator.evaluate((el, txt) => {
          el.focus();
          // Select all existing content first (only on first chunk)
          return document.execCommand("insertText", false, txt);
        }, chunk).catch(() => false);
        await page.waitForTimeout(100);
        if (!ok) break;
      }
      // Verify text was inserted by checking DOM content
      const afterExec = await readValue(inputBoxLocator);
      if (afterExec.length > 0) {
        injected = true;
      }
    }

    if (!injected) {
      // Last-resort: keyboard.insertText — works for React-controlled editors that
      // ignore raw value assignment because it dispatches synthetic InputEvent.
      const size = Number.isFinite(Number(chunkSize))
        ? Math.max(1, Number(chunkSize))
        : 20000;
      for (let i = 0; i < payload.length; i += size) {
        await page.keyboard.insertText(payload.slice(i, i + size));
        await page.waitForTimeout(80);
      }
      injected = true;
    }
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
