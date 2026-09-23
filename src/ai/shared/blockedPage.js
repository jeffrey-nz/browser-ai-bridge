import { logger } from "#utils/logger.js";

//[[ TELLING APART THE THREE WAYS A COMPOSER CAN BE MISSING.
//
//   When the input box never appears, the bridge sees one symptom —
//   `locator.waitFor: Timeout 15000ms exceeded` — and used to treat every cause
//   the same way: reload the page and retry. Three different things produce that
//   symptom and only one of them is helped by a reload.
//
//     1. A TIMED SUSPENSION. Measured on chat.deepseek.com, 2026-09-22:
//        "Due to violation of user policies, your account has been suspended
//         until October 1, 2026 09:21."
//        No password field, no sign-in button, no composer — just that sentence
//        and a "Contact us" link. Nine days away. Reloading achieves nothing and
//        so does retrying, for nine days.
//     2. A SIGN-IN WALL. A password field or a log-in control, and no composer.
//        Needs a human; reloading achieves nothing.
//     3. A genuinely transient fault — a half-loaded page, a dropped socket.
//        This is the only one a reload fixes, and it keeps the old behaviour.
//
//   The suspension case is the one worth parsing rather than merely detecting:
//   the notice states WHEN it ends, so the provider can be put on cooldown for
//   exactly that long instead of being retried every turn until the run ends.
//
//   Both detectors are deliberately conservative, because a false positive
//   discards a working provider: each requires the absence of a composer as well
//   as its own positive signal. A signed-in page that merely shows the words
//   "sign in" or "suspended" somewhere still has a composer and matches neither. ]]

const SIGNIN_SELECTORS = [
  'input[type="password"]',
  'button:has-text("Log in")',
  'button:has-text("Sign in")',
  'a:has-text("Log in")',
  'a:has-text("Sign in")',
  '[data-testid*="login" i]',
].join(", ");

const COMPOSER_SELECTORS =
  'textarea, [contenteditable="true"], input[type="text"][placeholder]';

/** "suspended until October 1, 2026 09:21" / "banned until 2026-10-01 09:21" */
const SUSPENDED_RE =
  /\b(?:suspend(?:ed)?|banned|restricted|blocked|disabled)\b[^.]{0,120}?\buntil\b\s+([^.)\n]{4,60})/i;
/** A suspension notice with no end time stated. */
const SUSPENDED_NO_DATE_RE =
  /\b(?:account|access)\b[^.]{0,80}\b(?:has been|is|was)\b[^.]{0,40}\b(?:suspend(?:ed)?|banned|restricted|disabled)\b/i;

// A misparse must not disable a provider for an implausible span. Nothing this
// bridge does runs for a month, so anything beyond that is treated as a parse
// failure rather than honoured.
const MAX_COOLDOWN_SECONDS = 30 * 24 * 60 * 60;
// Used when a suspension is stated with no readable end time: long enough not to
// hammer a blocked account, short enough that a brief block is not written off
// for the whole run.
export const UNKNOWN_SUSPENSION_SECONDS = 60 * 60;

/** Seconds until `text`'s stated end time, or null if it cannot be read. */
export function parseSuspensionSeconds(text, now = Date.now()) {
  const m = SUSPENDED_RE.exec(String(text || ""));
  if (!m) return null;
  const when = Date.parse(m[1].trim());
  if (Number.isNaN(when)) return null;
  const seconds = Math.ceil((when - now) / 1000);
  if (seconds <= 0) return null; // already expired — not a live suspension
  if (seconds > MAX_COOLDOWN_SECONDS) return null; // implausible; treat as unparsed
  return seconds;
}

const visible = (page, sel) =>
  page
    .locator(sel)
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);

/**
 * Why this page has no composer.
 * → { kind: 'suspended', seconds, notice } | { kind: 'signedOut' } | null
 */
export async function diagnoseBlockedPage(page, now = Date.now()) {
  // No diagnosis is possible, or needed, while a composer is on screen.
  if (await visible(page, COMPOSER_SELECTORS)) return null;

  const body = await page
    .evaluate(() => document.body?.innerText || "")
    .catch(() => "");

  if (SUSPENDED_RE.test(body) || SUSPENDED_NO_DATE_RE.test(body)) {
    const seconds =
      parseSuspensionSeconds(body, now) ?? UNKNOWN_SUSPENSION_SECONDS;
    const notice = (body.match(/[^\n]*\b(?:suspend|banned|restricted)[^\n]*/i) ||
      [""])[0].trim();
    return { kind: "suspended", seconds, notice };
  }

  if (await visible(page, SIGNIN_SELECTORS)) return { kind: "signedOut" };

  return null;
}

/** Back-compat shim for the earlier, narrower check. */
export async function looksSignedOut(page) {
  const d = await diagnoseBlockedPage(page);
  return d?.kind === "signedOut";
}

export function describeBlock(providerName, diagnosis) {
  if (diagnosis.kind === "suspended") {
    const hrs = (diagnosis.seconds / 3600).toFixed(1);
    logger.error(
      `[Blocked] ${providerName} account is SUSPENDED — holding it off for ${hrs}h. ` +
        `Notice: "${diagnosis.notice}"`,
    );
    return (
      `${providerName} account is suspended — ${diagnosis.notice || "no end time stated"}. ` +
      `Held off for ${hrs}h; retrying sooner cannot help.`
    );
  }
  logger.error(
    `[Blocked] ${providerName} appears to be SIGNED OUT — its composer is absent and a sign-in control is showing.`,
  );
  return (
    `${providerName} appears to be SIGNED OUT. Reloading cannot fix this; ` +
    "log in again (npm run bridge) or drop it from BROWSER_AI_PROVIDERS."
  );
}
