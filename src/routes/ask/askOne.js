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
import { describeUploadFailure } from "#ai/shared/uploadOutcome.js";

// T-079: pulled out of askOne's try-block so the shape of a successful
// result — which optional fields appear, and under what gate — is
// unit-testable without mocking sessionManager/resolveSession/
// executeAskTurn/withSessionLock. Mirrors ask.js's identical block:
// imageAttachedEvidence and visionModeVerdict are both nested inside the
// `imageAttached !== undefined` gate (both only ever arrive from the same
// image-upload code path in executeAskTurn, so one being defined without
// the other doesn't happen), but neither is further restricted to
// `imageAttached === true` — a failed upload's mode verdict, or its
// evidence, is still a fact worth reporting.
export function buildAskOneSuccessResult(providerId, turn) {
  const {
    response,
    data,
    turnIndex,
    sessionAgeMs,
    imageAttached,
    imageAttachedCause,
    imageAttachedEvidence,
    visionModeVerdict,
  } = turn;

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
      result.imageAttachedCause = imageAttachedCause;
      result.warning = describeUploadFailure(imageAttachedCause);
    }
    // T-058: a has-keys check, not a bare truthiness one — an empty {}
    // (uploadFileToPage threw before uploadFile.js ever set a field on
    // it, e.g. the NOT_OFFERED path) is truthy and would otherwise read
    // as "evidence was recorded and it was empty" instead of "there is
    // none". See ask.js's identical guard.
    if (
      imageAttachedEvidence &&
      Object.keys(imageAttachedEvidence).length > 0
    ) {
      result.imageAttachedEvidence = imageAttachedEvidence;
    }
    if (visionModeVerdict !== undefined) {
      result.visionModeVerdict = visionModeVerdict;
    }
  }
  return result;
}

/**
 * @returns {Promise<object>} always one of:
 *   { provider, answered: true, response, data, turnIndex, sessionAgeMs, imageAttached?, imageAttachedCause?, imageAttachedEvidence?, visionModeVerdict?, warning? }
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
        imageAttachedCause,
        imageAttachedEvidence,
        visionModeVerdict,
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

      return buildAskOneSuccessResult(providerId, {
        response,
        data,
        turnIndex,
        sessionAgeMs,
        imageAttached,
        imageAttachedCause,
        imageAttachedEvidence,
        visionModeVerdict,
      });
    } catch (err) {
      sessionManager.logTranscript(session.id, "SYSTEM_ERROR", err.message, {
        requestId,
      });
      if (err.message?.includes("Failed to submit prompt")) {
        // T-023: mark this as OUR close, not a browser-side collapse —
        // Manager.js's GC sweep / getSession self-prune would otherwise
        // record retiring a stuck tab as an unexpected page death.
        session.closedByBridge = true;
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
