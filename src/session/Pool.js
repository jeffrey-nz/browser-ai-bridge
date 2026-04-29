import process from "node:process";
import { logger } from "#utils/logger.js";
import { createNewSession } from "./Creator.js";
import { PROVIDER_CONFIG } from "../config/providers.js";

const POOL_SIZE = Number(process.env.POOL_SIZE ?? 1);

export class SessionPool {
  constructor() {
    this.warmSessions = new Map();
    this.isShuttingDown = false;
    this._warming = new Set(); // providers currently being warmed
  }

  async initializePool() {
    logger.info("Initializing connection pool (warming up standby tabs)...");
    for (const [providerId, config] of Object.entries(PROVIDER_CONFIG)) {
      if (!config.disabled) {
        this.warmSessions.set(providerId, []);

        this.replenish(providerId).catch((err) =>
          logger.warn(`[Pool] Initial warm-up failed for ${providerId}: ${err.message}`),
        );
      }
    }
  }

  async replenish(providerId) {
    if (this.isShuttingDown) return;
    if (this._warming.has(providerId)) return;

    const pool = this.warmSessions.get(providerId) || [];
    if (pool.length >= POOL_SIZE) return;

    this._warming.add(providerId);
    logger.debug(
      `[Pool] Replenishing ${providerId} standby tab (Current: ${pool.length}/${POOL_SIZE})`,
    );

    let session = null;
    try {
      session = await createNewSession(providerId);

      if (typeof session.engine?.startNewChat === "function") {
        await session.engine.startNewChat();
      }

      if (!this.isShuttingDown) {
        this.warmSessions.get(providerId).push(session);
        logger.info(`[Pool] ✨ ${providerId} standby tab is warm and ready.`);
      } else {
        await session.engine.close();
      }
    } catch (err) {
      logger.warn(`[Pool] Failed to warm up ${providerId}: ${err.message}`);
      if (session) {
        session.engine?.close?.().catch(() => {});
      }
    } finally {
      this._warming.delete(providerId);
    }
  }

  acquire(providerId) {
    const pool = this.warmSessions.get(providerId);
    if (pool && pool.length > 0) {
      const session = pool.shift();
      logger.info(
        `[Pool] 🚀 Fast-booting ${providerId} session from warm pool.`,
      );

      this.replenish(providerId).catch((err) =>
        logger.warn(`[Pool] Replenish failed for ${providerId}: ${err.message}`),
      );
      return session;
    }

    logger.debug(
      `[Pool] Pool empty for ${providerId}. Falling back to cold boot.`,
    );
    return null;
  }

  async shutdown() {
    this.isShuttingDown = true;
    logger.debug("[Pool] Shutting down standby tabs...");

    for (const [providerId, pool] of this.warmSessions.entries()) {
      while (pool.length > 0) {
        const session = pool.shift();
        try {
          await session.engine.close();
          await session.page.close().catch(() => {});
        } catch (e) {}
      }
    }
  }
}

export const sessionPool = new SessionPool();
