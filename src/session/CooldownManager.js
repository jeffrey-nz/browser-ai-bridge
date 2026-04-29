import { logger } from "#utils/logger.js";

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
  }

  check(providerId) {
    const unlockTime = this.cooldowns.get(providerId);
    if (!unlockTime) return { active: false };

    const remainingMs = unlockTime - Date.now();
    if (remainingMs > 0) {
      return { active: true, remainingSeconds: Math.ceil(remainingMs / 1000) };
    } else {
      this.cooldowns.delete(providerId);
      return { active: false };
    }
  }
}

export const cooldownManager = new CooldownManager();
