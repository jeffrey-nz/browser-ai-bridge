/**
 * askOne — one provider, one turn, as a plain result object rather than an
 * HTTP response.
 *
 * Factored out of the single-provider POST /api/ask route so /api/ask-all
 * (crew board T-002) can run N of these concurrently with Promise.all and
 * collect structured results, instead of writing straight to `res`.
 *
 * Deliberately NOT the tier-chain logic from ask/tiers.js: a fan-out request
 * names N INDEPENDENT providers to get N independent opinions from, so one
 * provider being unavailable must be reported as an absence for that
 * provider, never silently answered by a different one standing in for it.
 * That substitution is exactly what the chain in /api/ask does on purpose,
 * and exactly what would make a fan-out's "N answers" secretly fewer than N
 * distinct judges.
 */

import { sessionManager } from "../../session/index.js";
import { validatePromptLimit } from "./validation.js";
import { resolveSession, cleanupAutoSession } from "./sessionHandler.js";
import { executeAskTurn } from "./executor/index.js";
import { withSessionLock } from "./withSessionLock.js";
import { cooldownManager } from "../../session/CooldownManager.js";
import { logger } from "#utils/logger.js";

/**
 * @returns {Promise<object>} always one of:
 *   { provider, answered: true, response, data, turnIndex, sessionAgeMs, imageAttached?, warning? }
 *   { provider, answered: false, reason, retryAfter? }
 */
export async function askOne(providerId, prompt, requestId, opts = {}) {
  const {
    label,
    skipConstraint = false,
    mode = null,
    images = [],
    projectDir = "",
    pollTimeoutMs = 420000,
  } = opts;

  const cd = cooldownManager.check(providerId);
  if (cd.active) {
    return {
      provider: providerId,
      answered: false,
      reason: "cooldown",
      retryAfter: cd.remainingSeconds,
    };
  }

  const { session, autoCreated, error, status } = await resolveSession(
    null,
    providerId,
    mode,
  );
  if (error) {
    logger.warn(`[AskAll] ${providerId} unavailable: ${error} (${status})`);
    return { provider: providerId, answered: false, reason: error };
  }

  const pLimit = validatePromptLimit(session, prompt);
  if (!pLimit.valid) {
    await cleanupAutoSession(autoCreated, session);
    return { provider: providerId, answered: false, reason: pLimit.error };
  }

  return withSessionLock(session, autoCreated, async () => {
    try {
      const {
        response,
        data,
        turnIndex,
        sessionAgeMs,
        imageAttached,
        selfHealEscape,
      } = await executeAskTurn(
        session,
        prompt,
        requestId,
        label,
        pollTimeoutMs,
        {
          skipConstraint: !!skipConstraint,
          mode,
          images,
          projectDir,
          // A fan-out request has no fallback tier to yield TO, but yielding
          // still means the same thing it does in the chain: fail this one
          // provider's turn fast on a rate limit rather than sleeping up to
          // 9.5 minutes inside it — Promise.all waits for the slowest entry,
          // and a silent straggler is exactly what clause C (wall-clock ~=
          // the slowest single provider) rules out.
          yieldOnRateLimit: true,
        },
      );

      if (selfHealEscape) {
        return {
          provider: providerId,
          answered: false,
          reason: "self_heal_escape",
        };
      }

      const result = {
        provider: providerId,
        answered: true,
        response,
        data,
        turnIndex,
        sessionAgeMs,
      };
      if (imageAttached !== undefined) {
        result.imageAttached = imageAttached;
        if (!imageAttached) {
          result.warning =
            "The image could not be confirmed as attached to the provider's composer — this response may be text-only and should not be trusted as a visual answer.";
        }
      }
      return result;
    } catch (err) {
      sessionManager.logTranscript(session.id, "SYSTEM_ERROR", err.message, {
        requestId,
      });
      if (err.message?.includes("Failed to submit prompt")) {
        session.page?.close().catch(() => {});
      }
      return {
        provider: providerId,
        answered: false,
        reason: err.rateLimited
          ? "rate_limited"
          : err.stalled
            ? "stalled"
            : err.message,
      };
    }
  });
}
