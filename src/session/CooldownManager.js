import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";

// T-097: `cooldown` is published for all ten PROVIDER_CONFIG keys (health.js's
// buildProvidersPayload) and read by five call sites keyed on an arbitrary
// providerId (askOne.js, executor/stallLoop.js, ask/tiers.js's skipTier(),
// ask/validation.js) — but this class has exactly ONE writer:
// src/ai/gemini/interaction/prompt/errorHandler.js, two call sites, both
// `trigger("gemini", 120)`. For the other nine provider ids, `check()` used to
// return `{active:false}` — not a reading, but what the absence of a writer
// looks like, printed and read as if it were a measurement (41 of 41 recorded
// `"cooldown":false` readings in this repo's own evidence/reports; none of
// them, gemini included, ever the other way).
//
// Same shape health.js:80-92 already documents for `awaitingOperator`, one
// field over from where `cooldown` is published: a caller class (there,
// non-TTY callers; here, nine of ten providers) for whom the field can never
// be anything but its default. WRITABLE_PROVIDERS is that set, named here at
// the flag's own definition site rather than left to be inferred from a grep
// each time someone asks. If a future change gives another provider a real
// writer (T-097 clause 3's skipTier() decision, if it goes that way — chatgpt's
// err.rateLimited or deepseek's isRateLimited feeding this store), add it here
// in the SAME commit: a comment naming a writer set is only worth what its
// currency is worth.
//[[ 2026-09-22: a SECOND writer, as the note above asks for in the same commit.
//   `promptWorkflow._injectAndSendWithRecovery` now calls `trigger()` whenever a
//   page turns out to be showing a suspension notice rather than a composer, for
//   WHICHEVER provider that is — so the writer set is no longer a single name.
//   Measured cause: chat.deepseek.com answered "your account has been suspended
//   until October 1, 2026 09:21" with no composer and no sign-in control. Before
//   this, nothing wrote a cooldown for deepseek, so every turn paid 5 × (15s
//   locator timeout + 120s backoff) to rediscover a block with a stated end date.
//
//   The tri-state contract below is unchanged and still matters: a provider with
//   no writer must read `null`, not `false`. These are the ids that can now be
//   written, and the list is the whole point — adding a provider here without a
//   writer would put back exactly the conflation T-097 removed. Every generic
//   provider is included because the suspension check is in the shared send path
//   and applies to all of them. ]]
export const WRITABLE_PROVIDERS = new Set([
  "gemini",
  "deepseek",
  "kimi",
  "qwen",
  "zai",
  "mistral",
  "perplexity",
  "chatgpt",
  "copilot",
  "grok",
]);

class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
  }

  //[[ WHY A COOLDOWN EXISTS IS NOT ALWAYS "TO PREVENT UI BANS".
  //   That was true when gemini's 120s pacing was the only writer, and the 429
  //   in routes/ask/validation.js still says it to everyone. It is now wrong for
  //   the common case: grok's is a DAILY QUOTA the provider itself declared
  //   ("18 hours 49 minutes before limit is gone"), and telling a caller to
  //   "try again later" without saying it means tomorrow is close to useless.
  //   The reason is optional so every existing trigger() call is unchanged. ]]
  reasons = new Map();

  trigger(providerId, seconds, reason = null) {
    const unlockTime = Date.now() + seconds * 1000;
    this.cooldowns.set(providerId, unlockTime);
    if (reason) this.reasons.set(providerId, reason);
    else this.reasons.delete(providerId);
    logger.warn(
      `[Cooldown] ${providerId} placed on cooldown for ${seconds}s (until ${new Date(unlockTime).toLocaleTimeString()})`,
    );
    eventBus.emit("sync_event", {
      type: "provider_cooldown",
      provider: providerId,
      active: true,
      remainingSeconds: seconds,
      until: unlockTime,
    });
  }

  check(providerId) {
    // T-097: tri-state, same rule health.js's own LOADED_TREE_DIRTY already
    // follows — `null` for unmeasurable (no writer exists for this provider
    // at all), `false` for measured-and-clear, `true` for on cooldown. A
    // provider outside WRITABLE_PROVIDERS can never have an entry in
    // `this.cooldowns` (nothing calls trigger() for it), so returning `false`
    // here would be indistinguishable from a real, measured "not on cooldown
    // right now" — exactly the conflation this ticket exists to end.
    if (!WRITABLE_PROVIDERS.has(providerId)) {
      return { active: null, remainingSeconds: null };
    }

    const unlockTime = this.cooldowns.get(providerId);
    if (!unlockTime) return { active: false, remainingSeconds: 0 };

    const remainingMs = unlockTime - Date.now();
    if (remainingMs > 0) {
      return {
        active: true,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        until: unlockTime,
        ...(this.reasons.has(providerId)
          ? { reason: this.reasons.get(providerId) }
          : {}),
      };
    } else {
      this.cooldowns.delete(providerId);
      this.reasons.delete(providerId); // a lapsed reason must not outlive it
      eventBus.emit("sync_event", {
        type: "provider_cooldown",
        provider: providerId,
        active: false,
        remainingSeconds: 0,
      });
      return { active: false, remainingSeconds: 0 };
    }
  }

  isCoolingDown(providerId) {
    return this.check(providerId).active;
  }

  remainingSeconds(providerId) {
    // T-097: no `?? 0` fallback — `check()` already returns a real 0 for a
    // writable-but-clear provider, so the only thing `?? 0` could still be
    // catching here is the unmeasurable `null`, and coercing that to 0 would
    // reintroduce the exact conflation `check()` was just changed to end.
    return this.check(providerId).remainingSeconds;
  }

  // Returns snapshot of all providers (active or not) for the health endpoint.
  snapshot(providerIds) {
    return providerIds.reduce((acc, id) => {
      acc[id] = this.check(id);
      return acc;
    }, {});
  }
}

export const cooldownManager = new CooldownManager();
