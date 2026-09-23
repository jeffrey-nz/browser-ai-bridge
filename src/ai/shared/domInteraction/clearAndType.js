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
          el.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              inputType: "insertText",
              data: " ",
            }),
          );
        }
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, cancelable: true }),
        );
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "a", bubbles: true }),
        );
        el.dispatchEvent(
          new KeyboardEvent("keyup", { key: "a", bubbles: true }),
        );
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

//[[ "SOMETHING LANDED" IS NOT "THE PROMPT LANDED".
//
//   Every injection strategy below used to accept its own result on evidence
//   that does not scale with the prompt: strategy 0 asked for
//   `afterFill.length >= Math.min(payload.length, 50)`, which for a 9,868-char
//   book prompt is a threshold of FIFTY CHARACTERS, and strategies 1 and 2 asked
//   only for `length > 0`. A composer holding a fragment therefore counted as
//   injected, the fragment was sent, and the model answered it.
//
//   That is the worst failure shape the bridge has, because it is not an error.
//   Measured 2026-09-24: mistral, asked the 9.9KB chapter-23 quiz prompt,
//   replied "Hello, Jeffrey! How can I assist you today?" — a greeting, to a
//   prompt it never received, returned to the caller as success with
//   `success: true`. kimi failed the same prompt LOUDLY ("input did not clear
//   and generation did not start") and that is strictly better: a caller can
//   retry an error, and cannot detect a plausible answer to the wrong question.
//
//   The ratio is deliberately 0.9 rather than 1.0. These editors legitimately
//   alter what they hold — collapsing whitespace, normalising newlines — and
//   readValue trims, so an exact-length match would fail on healthy injections.
//   A tenth of a large prompt is far more slack than any of those need, and far
//   less than the difference between a prompt and a fragment of one. ]]
const MIN_INJECTION_RATIO = 0.9;
// Below this, a READABLE composer is holding a fragment rather than a tidied
// version of the prompt, and sending it asks a different question. See the
// throw site at the end of clearAndType for why an EMPTY read is not included.
export const REFUSE_BELOW_RATIO = 0.25;

/** Did roughly the whole payload land, rather than merely something? */
export function looksComplete(got, want) {
  if (!want.length) return true;
  return got.length >= Math.floor(want.length * MIN_INJECTION_RATIO);
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
            el.tagName === "TEXTAREA" ||
            (el.tagName === "INPUT" && el.type === "text"),
        )
        .catch(() => false);
      if (isPlainTextarea) {
        await inputBoxLocator.fill(payload, { timeout: 8000 });
        // .fill() auto-clears first, so this also satisfies the clear step.
        await page.waitForTimeout(200);
        const afterFill = await readValue(inputBoxLocator);
        // Was `>= Math.min(payload.length, 50)` — a 50-char bar for any prompt
        // longer than 50 chars. A short fill now falls through to the strategies
        // below instead of sending a fragment.
        if (looksComplete(afterFill, payload)) {
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
        // A paste that lands partially is the documented failure mode of this
        // strategy on controlled editors, so "> 0" was the wrong question.
        if (looksComplete(afterPaste, payload)) injected = true;
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
        if (looksComplete(afterEval, payload)) injected = true;
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
        const ok = await inputBoxLocator
          .evaluate((el, txt) => {
            el.focus();
            // Select all existing content first (only on first chunk)
            return document.execCommand("insertText", false, txt);
          }, chunk)
          .catch(() => false);
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

  // Callers ignore the return value today; it exists so a caller that wants to
  // refuse a truncated prompt can see what actually landed.
  if (!verify) return { injectedChars: null, payloadChars: payload.length };

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
  } else if (
    payload.trim().length > 0 &&
    current.length > 0 &&
    current.length < payload.length * REFUSE_BELOW_RATIO
  ) {
    //[[ A READABLE COMPOSER HOLDING A FRAGMENT IS THE ONE CASE WORTH REFUSING.
    //
    //   Measured 2026-09-24: mistral, given the 9.9KB book prompt, ended with
    //   "composer holds 1 of 9868 chars" and answered "It seems like you might
    //   have started typing something. Could you clarify?" — with success: true.
    //   A confident answer to a prompt that was never delivered is the worst
    //   thing this bridge can return, because a caller cannot detect it; kimi,
    //   which fails the same prompt loudly, is strictly better off.
    //
    //   Only this shape refuses. An EMPTY read does NOT, and must not: readValue
    //   returns "" for composers it cannot read, and in the same log 2 of the 8
    //   turns warned "input still empty" went on to answer correctly. Refusing
    //   those would break working providers to fix a broken one.
    //
    //   The threshold is far below looksComplete's 0.9 on purpose. Between the
    //   two lies the ordinary case — an editor that collapses whitespace or
    //   normalises newlines — which is worth a warning and not a refusal. Below
    //   a quarter, no amount of editor tidying explains the gap, and 1/9868 is
    //   not near any boundary. ]]
    throw new Error(
      `Failed to submit prompt: the composer holds ${current.length} of ${payload.length} characters. ` +
        "Sending it would ask a different question from the one requested.",
    );
  } else if (payload.trim().length > 0 && !looksComplete(current, payload)) {
    //[[ The case this block used to miss entirely. It only ever asked whether the
    //   composer was EMPTY, so a composer holding a fragment passed silently and
    //   the fragment was sent — which is how a greeting came back as the answer
    //   to a 9.9KB prompt. Say the two numbers: "short" is actionable in a log,
    //   "failed" is not. Still a warning rather than a throw, because every
    //   strategy above has already run and the caller's own submission check is
    //   the layer that decides whether to retry. ]]
    log(
      colors.yellow(
        `  (Injection verification: composer holds ${current.length} of ${payload.length} chars — the prompt may be sent truncated)`,
      ),
    );
  }

  return { injectedChars: current.length, payloadChars: payload.length };
}
