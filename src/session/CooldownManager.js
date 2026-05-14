import { logger } from "#utils/logger.js";
import { eventBus } from "#web/eventBus.js";

class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
  }

  trigger(providerId, seconds) {
    const unlockTime = Date.now() + seconds * 1000;
    this.cooldowns.set(providerId, unlockTime);
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
    const unlockTime = this.cooldowns.get(providerId);
    if (!unlockTime) return { active: false, remainingSeconds: 0 };

    const remainingMs = unlockTime - Date.now();
    if (remainingMs > 0) {
      return {
        active: true,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        until: unlockTime,
      };
    } else {
      this.cooldowns.delete(providerId);
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
    return this.check(providerId).remainingSeconds ?? 0;
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
