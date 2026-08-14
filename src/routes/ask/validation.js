import { PROVIDER_CONFIG } from "../../config/providers.js";
import { cooldownManager } from "../../session/CooldownManager.js";

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
      error: `Provider is on cooldown to prevent UI bans. Please try again later.`,
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
