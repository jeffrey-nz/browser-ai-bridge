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

  if (useClipboard) {
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
        injected = true;
      }
    } catch {}
  }

  if (!injected) {
    try {
      injected = await evalSetValue(inputBoxLocator, payload);
      if (injected) await page.waitForTimeout(800);
    } catch {}
  }

  if (!injected) {
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
