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
 */
export function skipTier(id, isCoolingDown = null) {
  const check = isCoolingDown ?? ((p) => cooldownManager.check(p));
  const cd = check(id);
  return cd.active
    ? { skip: true, remainingSeconds: cd.remainingSeconds }
    : { skip: false };
}

export function logFallback(from, to, why) {
  logger.warn(
    `[Tiers] ${from} unavailable (${why}) — falling through to ${to}. ` +
      `The chain is a preference, so ${from} is used again as soon as it clears.`,
  );
}
