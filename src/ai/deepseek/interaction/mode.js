import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { AI_MODES, resolveModeKey } from "#ai/modes.js";

// T-048: deepseek's default text mode ("Instant") does not reliably read an
// attached image — confirmed live: 5/5 pinned-fixture image turns in
// Instant mode came back "SEES=no" in a suspiciously tight ~51.3s band
// (45ms spread across 5 runs), and the page's own composer shows a
// "No text found. Try Vision." banner during that same window. Selecting
// "Vision" and resending the identical pinned fixture turned every one of
// those failures into a genuine PASS (SEES=yes COUNT=5 COLOR=crimson,
// live-verified) with 0/8 ERROR-timeouts across the two pinned samples
// this and T-068 ran post-fix.
//
// T-068 SOFTENED THE CLAIM: "cannot read an attached image AT ALL" is too
// strong. Instant mode does not consistently decline — driven directly via
// a synthetic DataTransfer + click (bypassing this function entirely, so
// Instant genuinely stayed selected), a truth.count=7 image got back
// "SEES=yes COUNT=1 COLOR=goldenrod" — a fabricated, wrong COUNT (colour
// happened to land right, 1-in-4 by chance) in ~8s, not the ~51s
// SEES=no band. This is very likely what T-045's own "COUNT=1" row was:
// Instant mode hallucinating a plausible answer rather than genuinely
// reading the image, not a Vision-mode bug and not evidence that Instant
// sometimes succeeds. selectDeepSeekVisionMode below is unconditional
// specifically because "usually declines, sometimes invents a wrong
// number" is a worse failure to leave unrouted than "always declines"
// would have been.
//
// This is a THIRD selector, separate from the DeepThink/Standard toggle
// setMode() already handles — a `role="radiogroup"` of three `role="radio"`
// options (Instant / Expert / Vision) sitting in the composer toolbar,
// found by live DOM inspection (nothing in this repo had ever looked for
// it before T-048).
//
// T-073: returns a VERDICT rather than resolving silently on success —
// this used to return undefined either way, so a radio that goes stale
// (the same shape T-018 found for chatgpt's attach button) or a click
// that lands on the wrong element/gets swallowed by an overlay was
// indistinguishable from one that genuinely selected Vision. Both silent
// paths are closed by re-reading aria-checked AFTER the click, not
// inferring success from the click call resolving:
//   "already-on"               — was already selected, nothing clicked.
//   "clicked-and-confirmed-on" — clicked, then re-read aria-checked=true.
//   "not-confirmed"            — radio never became visible (caught
//                                 below), OR the click resolved but
//                                 aria-checked still wasn't "true"
//                                 afterwards. Both collapse to the same
//                                 verdict because both mean the same
//                                 thing to a caller: Vision mode's state
//                                 is not confirmed, and per T-068 that is
//                                 NOT "will likely say SEES=no" — an
//                                 unrouted turn can come back with a
//                                 fabricated count that looks like a real
//                                 answer.
export async function selectDeepSeekVisionMode(page) {
  const vision = page.locator('[role="radio"]:has-text("Vision")').first();
  try {
    await vision.waitFor({ state: "visible", timeout: 10000 });
    const isCurrentlyOn =
      (await vision.getAttribute("aria-checked")) === "true";
    if (isCurrentlyOn) {
      log(`  ${colors.blue("ℹ")} DeepSeek Vision mode already selected.`);
      return { verdict: "already-on" };
    }
    await vision.click();
    const confirmedOn = (await vision.getAttribute("aria-checked")) === "true";
    if (confirmedOn) {
      log(`  ${colors.green("✔")} DeepSeek Vision mode selected.`);
      return { verdict: "clicked-and-confirmed-on" };
    }
    log(
      colors.yellow(
        `  ⚠️  Clicked DeepSeek Vision mode radio but it did not confirm on afterwards — sending the image with mode unconfirmed. T-068: this can come back with a fabricated count, not a "SEES=no" refusal.`,
      ),
    );
    return { verdict: "not-confirmed" };
  } catch (err) {
    log(
      colors.yellow(
        `  ⚠️  DeepSeek Vision mode radio not found — sending the image without it. T-068: this can come back with a fabricated count, not a "SEES=no" refusal.`,
      ),
    );
    return { verdict: "not-confirmed" };
  }
}

export async function setDeepSeekMode(page, rawModeKey) {
  const modeKey = resolveModeKey(rawModeKey);
  const isThinking = modeKey === AI_MODES.THINKING;

  log(
    `\n⚙️  Setting DeepSeek mode: ${colors.bold(isThinking ? "DeepThink (R1)" : "Standard (V3)")}...`,
  );

  const toggle = page
    .locator('.ds-toggle-button:has-text("Deep thinking")')
    .first();

  try {
    await toggle.waitFor({ state: "visible", timeout: 10000 });

    const isCurrentlyOn = await toggle.evaluate((el) =>
      el.classList.contains("ds-toggle-button--selected"),
    );

    if (isThinking !== isCurrentlyOn) {
      await toggle.click();
      log(`  ${colors.green("✔")} Mode switched.`);
    } else {
      log(`  ${colors.blue("ℹ")} Mode already correct.`);
    }
  } catch (err) {
    log(
      colors.yellow(
        `  ⚠️  DeepThink toggle not found. Proceeding with current state.`,
      ),
    );
  }

  // Always ensure web Search is OFF. When Search is enabled, DeepSeek augments
  // replies with web results and conversational framing, which corrupts the
  // strict-JSON responses callers expect (the reply parses as garbage and the
  // turn is wasted). The Search toggle can get left on across sessions, so we
  // proactively turn it off on every prompt rather than assume a clean state.
  const searchToggle = page
    .locator('.ds-toggle-button:has-text("Search")')
    .first();
  try {
    await searchToggle.waitFor({ state: "visible", timeout: 5000 });
    const searchOn = await searchToggle.evaluate((el) =>
      el.classList.contains("ds-toggle-button--selected"),
    );
    if (searchOn) {
      await searchToggle.click();
      log(`  ${colors.green("✔")} Web Search disabled (was on).`);
    }
  } catch (err) {
    log(
      colors.yellow(
        `  ⚠️  Search toggle not found. Proceeding with current state.`,
      ),
    );
  }
}
