import express from "express";
import crypto from "node:crypto";
import { sessionManager } from "../session/index.js";
import { validateRequest, validatePromptLimit } from "./ask/validation.js";
import { resolveSession, cleanupAutoSession } from "./ask/sessionHandler.js";
import { executeAskTurn } from "./ask/executor/index.js";
import { withSessionLock } from "./ask/withSessionLock.js";
import { resolveTiers, skipTier, logFallback } from "./ask/tiers.js";
import { sendSuccess, sendError } from "../middleware/respond.js";
import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";
import { describeUploadFailure } from "#ai/shared/uploadOutcome.js";

const router = express.Router();

router.post("/", async (req, res, next) => {
  const {
    sessionId,
    provider,
    prompt,
    label,
    skipConstraint,
    mode,
    images,
    projectDir,
  } = req.body;
  const isReviewerTurn = /reviewer/i.test(label ?? "");
  const pollTimeoutMs = isReviewerTurn ? 3 * 60 * 1000 : 7 * 60 * 1000;
  const requestId = crypto.randomUUID();

  //[[ The tier chain, and why the cooldown check below is conditional on it.
  //
  //   `validateRequest` 429s when the NAMED provider is cooling down, which is
  //   right for a single-provider request and exactly backwards for a chain:
  //   being on cooldown is the condition a fallback exists to answer. So the
  //   chain is resolved first, and a request that has somewhere else to go
  //   skips the gate and picks the first tier that is free. ]]
  const tiers = resolveTiers(req.body);
  const chained = tiers.length > 1;

  //[[ Validate against the chain's HEAD, not the bare `provider` field.
  //
  //   `{"providers": ["gemini", "chatgpt"]}` names a provider perfectly well
  //   and has no `provider` key at all, so validating the raw field rejected it
  //   as "Missing provider or sessionId". Second bug of this exact shape: the
  //   chain resolver was unit-tested and the thing CONSUMING it was not, so
  //   both times the tests were green and the bridge answered nothing. ]]
  const head = provider ?? tiers[0];
  const v = validateRequest(req, sessionId, head, { skipCooldown: chained });
  if (!v.valid) {
    if (v.retryAfter) res.set("Retry-After", String(v.retryAfter));
    return sendError(
      res,
      v.status,
      v.error,
      { retryAfter: v.retryAfter },
      requestId,
    );
  }

  //[[ ONE ATTEMPT PER TIER, in order.
  //
  //   The chain is walked rather than sampled: tier 0 is asked whenever it is
  //   available, so a fallback lasts exactly as long as the cooldown that
  //   caused it and nothing has to remember to switch back.
  //
  //   A tier is skipped without being asked when it is already cooling down,
  //   and dropped mid-turn when it rate-limits -- `yieldOnRateLimit` makes the
  //   executor return immediately instead of sleeping 90s+ waiting for the same
  //   provider to forgive us. That sleep is right when there is nowhere else to
  //   go and is the whole problem when there is.
  const attempted = [];
  let lastRetryAfter;

  for (let i = 0; i < Math.max(tiers.length, 1); i++) {
    const candidate = chained ? tiers[i] : head;
    const remaining = chained ? tiers.slice(i + 1) : [];

    if (chained) {
      const cd = skipTier(candidate);
      if (cd.skip) {
        lastRetryAfter = Math.min(
          lastRetryAfter ?? Infinity,
          cd.remainingSeconds,
        );
        attempted.push({ provider: candidate, outcome: "cooldown" });
        continue;
      }
    }

    const { session, autoCreated, error, status, retryAfter } =
      await resolveSession(sessionId, candidate, mode);
    if (error) {
      if (autoCreated && session) await cleanupAutoSession(true, session);
      if (remaining.length) {
        attempted.push({ provider: candidate, outcome: error });
        logFallback(candidate, remaining[0], error);
        continue;
      }
      if (retryAfter) res.set("Retry-After", String(retryAfter));
      return sendError(
        res,
        status,
        error,
        retryAfter ? { retryAfter } : {},
        requestId,
      );
    }

    const pLimit = validatePromptLimit(session, prompt);
    if (!pLimit.valid) {
      await cleanupAutoSession(autoCreated, session);
      return sendError(
        res,
        pLimit.status,
        pLimit.error,
        { max: pLimit.max },
        requestId,
      );
    }

    // If the HTTP client disconnects before we finish writing the response
    // (e.g. a fetch AbortController fires), force-release the session lock so
    // subsequent turns don't pile up with 409. The background browser-AI turn
    // may still be running — needsReset ensures it cleans up before the next
    // caller uses the session.
    //
    // Use req.on("close") not res.on("close"): res "close" only fires after the
    // server actually tries to write to a broken socket (i.e. after the browser
    // automation finishes), which can be 7+ minutes later. req "close" fires
    // immediately when the client drops the TCP connection.
    const onClose = () => {
      if (!res.writableEnded && session.locked) {
        logger.warn(
          `[Ask] Client disconnected mid-turn for session ${session.id?.slice(0, 8)} - force-releasing stale lock`,
        );
        session.locked = false;
        session.needsReset = true;
        eventBus.emit(`session_abort:${session.id}`);
      }
    };
    req.on("close", onClose);

    const outcome = await withSessionLock(session, autoCreated, async () => {
      try {
        const {
          response,
          data,
          turnIndex,
          sessionAgeMs,
          selfHealEscape,
          htmlSnapshot,
          imageAttached,
          imageAttachedCause,
          imageAttachedEvidence,
        } = await executeAskTurn(
          session,
          prompt,
          requestId,
          label,
          pollTimeoutMs,
          {
            skipConstraint: !!skipConstraint,
            mode,
            images: Array.isArray(images) ? images : [],
            projectDir: projectDir || "",
            // Only yield when there is somewhere to yield TO.
            yieldOnRateLimit: remaining.length > 0,
          },
        );

        if (selfHealEscape) {
          return {
            done: true,
            send: () =>
              sendSuccess(
                res,
                {
                  selfHealEscape: true,
                  htmlSnapshot: htmlSnapshot || "",
                  response: "",
                  data: null,
                  provider: session.providerId,
                },
                requestId,
              ),
          };
        }

        //[[ WHO ANSWERED, always. A caller comparing scores between turns
        //   cannot tell two judges apart without it, and averaging two models'
        //   scales is the failure this field exists to make impossible. ]]
        //
        //   imageAttached is the honest companion to that: present only when
        //   this turn carried an image, and false when the upload could not
        //   be confirmed on the provider's page — success:true still means
        //   the HTTP turn completed, but a caller that asked a question about
        //   a picture and gets imageAttached:false is looking at a text-only
        //   answer wearing a confident face (T-001 on the crew board).
        //
        //   imageAttached:false used to mean less than it looked like it
        //   meant: thirteen different sites could produce it, for reasons as
        //   different as "this provider has no upload path at all" and "a
        //   file was handed to the composer and might well have landed, but
        //   nothing confirmed it in time" — one boolean plus one constant
        //   warning string could not tell those apart, and 30 of 30 recorded
        //   false rows (including the flag's one known refutation) were
        //   unattributable as a result (T-038). imageAttachedCause is the
        //   split: present exactly when imageAttached is false, one of
        //   not_offered / unconfirmed / no_upload_path / text_only_retry /
        //   upload_error (src/ai/shared/uploadOutcome.js). `unconfirmed` is
        //   the one worth treating differently from the rest — it is the
        //   only value consistent with an image that actually arrived.
        //
        //   turnIndex/sessionAgeMs replace the old messageCount field
        //   (T-011): messageCount was computed for one provider (copilot) of
        //   ten and hardcoded 0 for the rest, and nothing read it, but it
        //   LOOKED like it told a caller how far into a session an answer
        //   was taken — the actual thing a corpus collected over an
        //   unattended run needs to order its own answers by. These two
        //   fields say that honestly instead: turnIndex is this session's
        //   own turn counter (1 on a fresh session), sessionAgeMs is how
        //   long the session has existed at the moment this turn finished.
        const payload = {
          response,
          data,
          turnIndex,
          sessionAgeMs,
          provider: session.providerId,
        };
        if (imageAttached !== undefined) {
          payload.imageAttached = imageAttached;
          if (!imageAttached) {
            payload.imageAttachedCause = imageAttachedCause;
            payload.warning = describeUploadFailure(imageAttachedCause);
          }
          // T-053: `true` has multiple distinguishable producing conditions
          // and used to record none of them. T-053 review: not gated to the
          // `true` branch any more — a FALSE row can carry evidence too (at
          // minimum which selector was actually in effect), which is what
          // lets a deliberate evidence-break test prove its own claim
          // instead of relying on a filename or a hand-typed note.
          if (imageAttachedEvidence) {
            payload.imageAttachedEvidence = imageAttachedEvidence;
          }
        }
        return {
          done: true,
          send: () => sendSuccess(res, payload, requestId),
        };
      } catch (err) {
        sessionManager.logTranscript(session.id, "SYSTEM_ERROR", err.message, {
          requestId,
        });

        // A persistent submission failure means the browser tab is stuck (rate-limit
        // modal, auth wall, DOM in bad state). Close the page so _recycleOrClose
        // doesn't put a broken tab back into the pool for the next request.
        if (err.message?.includes("Failed to submit prompt")) {
          // T-023: mark this as OUR close, not a browser-side collapse — see
          // the matching comment in askOne.js.
          session.closedByBridge = true;
          session.page?.close().catch(() => {});
        }

        if (err.rateLimited && remaining.length) {
          return { done: false, why: "rate limit" };
        }

        if (err.stalled) {
          return {
            done: true,
            send: () =>
              sendError(
                res,
                503,
                "STALLED",
                { stalled: true, rateLimited: !!err.rateLimited, attempted },
                requestId,
              ),
          };
        }
        return {
          done: true,
          send: () => sendError(res, 500, err.message, {}, requestId),
        };
      }
    });

    req.off("close", onClose);

    if (outcome.done) return outcome.send();

    attempted.push({ provider: candidate, outcome: outcome.why });
    logFallback(candidate, remaining[0], outcome.why);
  }

  //[[ Every tier was cooling down or rate-limited. The caller is told the
  //   SHORTEST remaining wait, because that is when the chain comes back --
  //   reporting tier 0's would send a client to sleep past a provider that was
  //   already free. ]]
  if (lastRetryAfter && Number.isFinite(lastRetryAfter)) {
    res.set("Retry-After", String(lastRetryAfter));
  }
  return sendError(
    res,
    503,
    "STALLED",
    { stalled: true, rateLimited: true, retryAfter: lastRetryAfter, attempted },
    requestId,
  );
});

export default router;
