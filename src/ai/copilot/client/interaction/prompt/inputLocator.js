import { ensureLocator } from "../ensureLocator.js";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

async function ensureFocusable(locator) {
  await locator.waitFor({ state: "visible", timeout: 12000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true }).catch(() => {});
  await locator.focus().catch(() => {});
}

export async function getChatInputArea(page) {
  // T-108 clause 2: this used to carry its OWN 9-selector list, joined and
  // resolved with `.filter({visible:true}).last()` — a comma-joined CSS
  // selector resolves in DOCUMENT order, so `.last()` means "latest in the
  // page", not "highest in this list". FALLBACK_SELECTORS.input_box (in
  // ./locator/fallbacks.js) is a DIFFERENT 8-selector list for the same
  // control, walked in order by tryFallbacks (first visible wins — an
  // order that actually binds). The two disagreed on a real fixture
  // (measured: this ticket's goal). Passing `null` here means there is no
  // separate priority list any more — FALLBACK_SELECTORS.input_box, walked
  // in order, is the one and only resolution for this key.
  const loc = await ensureLocator(
    page,
    "input_box",
    "the chat text area",
    null,
  );

  try {
    await ensureFocusable(loc);
  } catch (e) {
    log(
      colors.yellow(
        `  [Input] Warning: could not fully focus input (${e.message}). Continuing...`,
      ),
    );
  }

  return loc;
}
