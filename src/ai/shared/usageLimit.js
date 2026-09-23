//[[ A USAGE LIMIT THAT TELLS YOU HOW LONG IT LASTS, AND WHAT IT COST NOT TO READ IT.
//
//   This is NOT the same thing as blockedPage.js's suspension. There the composer
//   is GONE and the page is a wall. Here the account is fine, the composer is
//   right there, and the provider simply will not answer again until its quota
//   window rolls over — so diagnoseBlockedPage() correctly returns null and
//   nothing else was reading the one useful thing on the page.
//
//   MEASURED, grok.com, 2026-09-24, ten tabs open at once:
//
//     "18 hours 49 minutes before limit is gone"
//     "Wait or upgrade to SuperGrok for much higher limits and premium features."
//
//   Grok's poll already DETECTED this (src/ai/grok/interaction/prompt/poll.js
//   throws err.rateLimited) and then threw the number away. Downstream, the only
//   cooldown anyone applied was the client's flat five minutes — against a
//   NINETEEN HOUR limit. The evidence of what that costs was sitting in the tab
//   list: ten grok tabs, their countdowns reading 18h49m, 18h50m, 18h51m …
//   18h56m — one per minute, each a fresh tab, a fresh prompt injection and a
//   full wasted turn, all to rediscover a number the first page had already
//   printed. That would have continued for nineteen hours.
//
//   src/routes/ask/tiers.js names the precondition for wiring a provider into
//   cooldownManager: "If chatgpt/deepseek get a real per-provider TTL from a
//   measured source, wire it through WRITABLE_PROVIDERS in the same commit that
//   adds it here." A countdown the provider itself prints is exactly that — it is
//   not a guessed constant like gemini's unargued 120s, it is the provider
//   stating when it will answer again. ]]
import { logger } from "#utils/logger.js";

/** Wording that means "you are out of quota", as opposed to a transient stall. */
const LIMIT_RE =
  /\b(?:limit|quota|rate.?limit|too many requests|out of (?:messages|credits|uses))\b/i;

/** "18 hours 49 minutes", "45 minutes", "2h 30m", "30 seconds". */
const UNIT_RE = /(\d{1,4})\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;

const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };

function unitKey(word) {
  const w = word.toLowerCase();
  if (w.startsWith("h")) return "h";
  if (w.startsWith("sec") || w === "s") return "s";
  if (w.startsWith("m")) return "m";
  return null;
}

// A misparse must not bench a provider for an implausible span. A usage window
// is hours or a day; a week is already far past anything a quota does, so past
// that this reports a parse failure rather than honouring the number.
const MAX_LIMIT_SECONDS = 7 * 24 * 60 * 60;

//[[ NOT A MEASUREMENT, AND SAID SO. When a limit is detected but states no
//   readable countdown, something has to be chosen. 15 minutes is a judgement
//   with a stated reason rather than a number copied from elsewhere: it is long
//   enough to stop the once-a-minute retry storm that produced ten grok tabs,
//   and short enough that a provider whose limit was genuinely brief is not
//   written off for the rest of a run. Any provider that PRINTS its countdown
//   gets the real figure instead and never reaches this. ]]
export const UNKNOWN_LIMIT_SECONDS = 15 * 60;

/**
 * Seconds until a stated usage limit lifts, or null when the text states none.
 *
 * Only durations on a line that also talks about a limit are read, so a chat
 * message that happens to say "two hours" cannot bench a provider.
 */
export function parseLimitCountdown(text) {
  const lines = String(text || "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length > 300) continue;
    if (!LIMIT_RE.test(line)) continue;

    let seconds = 0;
    let matched = false;
    UNIT_RE.lastIndex = 0;
    let m;
    while ((m = UNIT_RE.exec(line)) !== null) {
      const key = unitKey(m[2]);
      if (!key) continue;
      seconds += Number(m[1]) * UNIT_SECONDS[key];
      matched = true;
    }
    if (!matched || seconds <= 0) continue;
    if (seconds > MAX_LIMIT_SECONDS) continue; // implausible — treat as unparsed
    return seconds;
  }
  return null;
}

/**
 * Read a limit countdown off a live page. Returns seconds, or null when the
 * page shows no limit notice at all. A notice with no readable countdown
 * returns UNKNOWN_LIMIT_SECONDS.
 */
export async function readLimitSeconds(page) {
  const body = await page
    .evaluate(() => document.body?.innerText || "")
    .catch(() => "");
  if (!body || !LIMIT_RE.test(body)) return null;
  return parseLimitCountdown(body) ?? UNKNOWN_LIMIT_SECONDS;
}

/** The notice line itself, for a log a human has to act on. */
export function limitNotice(text) {
  const line = String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && s.length < 300 && LIMIT_RE.test(s));
  return line || "";
}

export function describeLimit(providerName, seconds, notice) {
  const hrs = seconds / 3600;
  const span = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
  logger.warn(
    `[Limit] ${providerName} is out of quota for ${span}` +
      (notice ? ` — "${notice}"` : "") +
      ". Holding it off; asking again before then cannot succeed.",
  );
  return (
    `${providerName} has hit its usage limit${notice ? ` — ${notice}` : ""}. ` +
    `Held off for ${span}; retrying sooner cannot help.`
  );
}
