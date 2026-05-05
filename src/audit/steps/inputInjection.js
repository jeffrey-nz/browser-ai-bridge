import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

const AUDIT_PROMPT =
  "Hello, this is an automated audit test verifying DOM selectors. Please reply exactly with: 'AUDIT_OK'.";

export async function stepInputInjection(page, locs) {
  const input = page.locator(locs.inputBox).last();
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.click({ force: true });
  await page.waitForTimeout(200);

  // React controlled <textarea> elements don't update state when Playwright fires
  // CDP key events (isTrusted=false), so pressSequentially leaves React's state
  // empty — the send button stays disabled and clicks are no-ops.
  // Using the native prototype value setter + InputEvent bypasses React's own
  // value tracking and forces onChange to fire correctly.
  //
  // contenteditable editors (ProseMirror / Quill / Lexical) need real keyboard
  // events. pressSequentially is too slow for long prompts (30s timeout risk),
  // so we use clipboard paste instead — one Ctrl+V replaces N key events.
  const isContentEditable = await input
    .evaluate((el) => el.isContentEditable)
    .catch(() => false);

  if (isContentEditable) {
    // Clipboard paste fails in multi-tab CI mode (no user gesture / focus).
    // keyboard.type() is reliable for short audit prompts across all editors.
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(AUDIT_PROMPT);
  } else {
    await input.evaluate((el, text) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el),
        "value",
      )?.set;
      if (nativeSetter) nativeSetter.call(el, text);
      else el.value = text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, AUDIT_PROMPT);
  }

  await page.waitForTimeout(500);

  // Verify the editor actually registered the text
  const typed = isContentEditable
    ? (await input.innerText({ timeout: 1000 }).catch(() => "")) ||
      (await input.textContent({ timeout: 1000 }).catch(() => ""))
    : await input.inputValue({ timeout: 1000 }).catch(() => "");

  if (!typed || typed.trim().length === 0) {
    log(
      colors.yellow(
        `  [WARN] Input text not detected after typing — editor may not have registered the input.`,
      ),
    );
  }

  return true;
}
