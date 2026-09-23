import { PROVIDER_CONFIG } from "../../config/providers.js";
import { cooldownManager } from "../../session/CooldownManager.js";

//[[ "TRY AGAIN LATER" IS NOT AN ANSWER WHEN LATER MEANS TOMORROW.
//
//   This 429 told every caller the provider was "on cooldown to prevent UI
//   bans", which was true when gemini's 120s pacing was the only writer and is
//   now the uncommon case. Measured 2026-09-24: grok's cooldown is a DAILY quota
//   the provider itself declared — "18 hours 49 minutes before limit is gone" —
//   and a caller told to try later, with no span and a reason that is not the
//   real one, has no way to tell a two-minute pacing pause from a lost day.
//   `retryAfter` already carried the number; this makes the sentence match it. ]]
export function cooldownMessage(providerId, cd) {
  const secs = cd.remainingSeconds;
  const span =
    secs >= 3600 ? `${(secs / 3600).toFixed(1)}h` : `${Math.ceil(secs / 60)} min`;
  const why = cd.reason ? ` — ${cd.reason}` : "";
  // Over an hour is a quota window, not the short pacing pause this used to
  // describe; say which, because what a caller should do differs.
  return secs >= 3600
    ? `${providerId} is out of quota for another ${span}${why}. Asking again before then cannot succeed — use another provider.`
    : `${providerId} is on cooldown for another ${span}${why}. Please try again later.`;
}

/**
 * @param {object} opts
 * @param {boolean} opts.skipCooldown  the request has a tier chain, so a
 *   provider on cooldown is the condition the chain exists to answer rather
 *   than a reason to refuse. The route picks the first free tier itself.
 */
export function validateRequest(
  req,
  sessionId,
  provider,
  { skipCooldown = false } = {},
) {
  // Required: prompt. Optional: mode, label, skipConstraint.
  if (!req.body.prompt) {
    return { valid: false, status: 400, error: "Missing prompt" };
  }

  if (!sessionId && !provider) {
    return {
      valid: false,
      status: 400,
      error: "Missing provider or sessionId",
    };
  }

  const checkId = provider || (sessionId ? null : undefined);

  if (checkId && !PROVIDER_CONFIG[checkId]) {
    return {
      valid: false,
      status: 400,
      error: `Unknown provider specified: ${checkId}`,
    };
  }

  const cd = cooldownManager.check(checkId || provider);
  if (cd.active && !skipCooldown) {
    return {
      valid: false,
      status: 429,
      error: cooldownMessage(checkId || provider, cd),
      retryAfter: cd.remainingSeconds,
    };
  }

  return { valid: true };
}

export function validatePromptLimit(session, prompt) {
  const config = PROVIDER_CONFIG[session.providerId];
  if (config && prompt.length > config.maxPromptChars) {
    return {
      valid: false,
      status: 413,
      error: `Prompt exceeds provider character limit of ${config.maxPromptChars}`,
      max: config.maxPromptChars,
    };
  }
  return { valid: true };
}
