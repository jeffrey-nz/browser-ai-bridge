import { PROVIDER_CONFIG } from "../../config/providers.js";
import { cooldownManager } from "../../session/CooldownManager.js";
import { logger } from "#utils/logger.js";

/**
 * The provider tier chain: who answers when the one you asked for cannot.
 *
 * A rate limit is a property of an ACCOUNT AND A CLOCK, not of the question.
 * Gemini going into a two-minute cooldown says nothing about whether ChatGPT
 * could answer the same prompt right now, and a batch that stops dead for two
 * minutes every time it happens is a batch whose wall-clock is set by the
 * unluckiest provider in it.
 *
 * So a request can name an ordered chain and the bridge walks it: first tier
 * that is neither on cooldown nor rate-limiting gets the turn. The chain is a
 * PREFERENCE, not a pool -- tier 0 is asked every time it is available, so a
 * fallback is temporary by construction and the run returns to the preferred
 * judge the moment its cooldown expires.
 *
 * **The answer says who gave it.** Every response carries `provider`, because a
 * caller that cares which model spoke -- and any caller comparing scores does --
 * cannot otherwise tell. See arcade-sim's `Tools/critique.py`, which anchors a
 * score against reference frames scored by the SAME judge in the same session,
 * and would silently average two different scales without this field.
 */

/** Providers to fall through to when none is named on the request. */
export function defaultTiers() {
  const raw = process.env.PROVIDER_TIERS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && PROVIDER_CONFIG[s]);
}

/**
 * The chain for one request, in order, de-duplicated and known-provider only.
 *
 * `providers` (or the older `fallback`) names it explicitly; otherwise the
 * requested provider is tried first and `PROVIDER_TIERS` supplies the rest.
 * A `sessionId` request gets no chain at all: the caller is continuing a
 * particular conversation, and answering it from a different tab would be a
 * different conversation wearing the same id.
 */
export function resolveTiers(body) {
  if (body.sessionId) return [];

  const named = Array.isArray(body.providers)
    ? body.providers
    : Array.isArray(body.fallback)
      ? [body.provider, ...body.fallback]
      : null;

  const chain = named ?? [body.provider, ...defaultTiers()];

  const seen = new Set();
  return chain.filter((id) => {
    if (!id || !PROVIDER_CONFIG[id] || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Should this tier be skipped without being asked, and for how long?
 *
 * Extracted from the route's loop so it can be tested. Both wiring bugs this
 * change shipped were inline branches in that loop with green unit tests
 * beside them -- the chain resolver was covered and the code CONSUMING it was
 * not, so the bridge answered nothing while the suite stayed green. A decision
 * worth making is a decision worth naming.
 *
 * `isCoolingDown` is injected so a test does not need a real rate limit.
 *
 * T-097, decided in writing rather than left as an accident of who wrote a
 * cooldown call first: this can only ever skip GEMINI. Its only input is
 * cooldownManager, and cooldownManager has exactly one writer
 * (CooldownManager.js's own WRITABLE_PROVIDERS note). chatgpt's
 * `err.rateLimited` and deepseek's `isRateLimited` are detected independently
 * (chat.js, poll.js, domState.js) but feed nothing here -- a rate limit this
 * bridge already saw on a previous turn is rediscovered at full cost on the
 * next request for those two, rather than skipped. Measured cost: a turn on
 * this bridge runs 13s-46s (roles/method.md's own latency table), so a chain
 * that includes chatgpt or deepseek pays a full turn to relearn what it
 * already knew, once per request, until the account-side limit clears on its
 * own. Chose NOT to wire them into cooldownManager here: gemini's 120s is an
 * unargued literal (errorHandler.js) with no stated source, and copying an
 * equally unargued number onto two more providers would be worse than
 * leaving the gap named. If chatgpt/deepseek get a real per-provider TTL from
 * a measured source, wire it through WRITABLE_PROVIDERS in the same commit
 * that adds it here.
 */
export function skipTier(id, isCoolingDown = null) {
  const check = isCoolingDown ?? ((p) => cooldownManager.check(p));
  const cd = check(id);
  return cd.active
    ? { skip: true, remainingSeconds: cd.remainingSeconds }
    : { skip: false };
}

/**
 * Did any tier actually rate-limit, going by what `attempted` itself
 * recorded? (T-113) The chain-exhausted 503 used to hardcode
 * `rateLimited: true` unconditionally, but that response is reachable with
 * every tier skipped purely for being on cooldown — zero rate-limit events
 * that turn, `attempted` reading all `"cooldown"` outcomes, and the body
 * still claiming one happened. `"rate limit"` (a space, not the
 * `"rate_limited"` /api/ask-all uses — see API.md) is the ONE outcome
 * string ask.js's own loop writes for that mechanism (ask.js:309, when
 * `outcome.why` is `"rate limit"` from ask.js:282); every other write is
 * either `"cooldown"` or a raw resolveSession error string.
 */
export function anyRateLimited(attempted) {
  return attempted.some((a) => a.outcome === "rate limit");
}

export function logFallback(from, to, why) {
  logger.warn(
    `[Tiers] ${from} unavailable (${why}) — falling through to ${to}. ` +
      `The chain is a preference, so ${from} is used again as soon as it clears.`,
  );
}
