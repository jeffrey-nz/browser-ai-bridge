import process from "node:process";
import { logger } from "#utils/logger.js";
import { createNewSession } from "./Creator.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import { LIMITS as TAB_LIMITS } from "./TabJanitor.js";

const POOL_SIZE = Number(process.env.POOL_SIZE ?? 1);
// How long to suppress replenishment after a warmup failure (e.g. stalled/throttled).
const REPLENISH_COOLDOWN_MS = 5 * 60 * 1000;

export class SessionPool {
  constructor() {
    this.warmSessions = new Map();
    this.isShuttingDown = false;
    this._warming = new Set(); // providers currently being warmed
    this._failedAt = new Map(); // providerId → timestamp of last replenish failure
    //[[ How many LIVE sessions a provider has. Injected by SessionManager, which
    //   owns the registry — importing it here would be circular. Defaults to 0 so
    //   a pool used standalone (tests) behaves exactly as it did before. ]]
    this.countLive = () => 0;
  }

  async initializePool() {
    logger.info(
      "Initializing connection pool (lazy — tabs open on first use)...",
    );
    for (const [providerId, config] of Object.entries(PROVIDER_CONFIG)) {
      if (!config.disabled) {
        this.warmSessions.set(providerId, []);
        // Do NOT pre-warm here. Tabs are opened on-demand when acquire() is
        // first called for each provider, so unused providers (e.g. grok,
        // unused providers never create browser tabs.
      }
    }
  }

  async replenish(providerId) {
    if (this.isShuttingDown) return;
    if (this._warming.has(providerId)) return;

    // Back off after a recent failure so a throttled/stalled provider doesn't
    // keep flapping (open tab → stall → close → open → …).
    const failedAt = this._failedAt.get(providerId);
    if (failedAt && Date.now() - failedAt < REPLENISH_COOLDOWN_MS) {
      logger.debug(
        `[Pool] Skipping ${providerId} replenish — cooldown active (${Math.round((REPLENISH_COOLDOWN_MS - (Date.now() - failedAt)) / 1000)}s left)`,
      );
      return;
    }

    if (!this.warmSessions.has(providerId)) {
      this.warmSessions.set(providerId, []);
    }
    const pool = this.warmSessions.get(providerId);
    if (pool.length >= POOL_SIZE) return;

    //[[ A WARM TAB IS STILL A TAB, AND THIS POOL WAS NOT COUNTING THEM.
    //
    //   Replenish checked only its own POOL_SIZE, so a provider already holding
    //   maxSessionsPerProvider live sessions still got a standby tab opened on
    //   top — and because this calls createNewSession() directly rather than
    //   Manager.createSession(), it went round the creation cap entirely.
    //   Measured 2026-09-24 with the cap at 2: chatgpt and gemini repeatedly sat
    //   at 3-5 tabs while the census reported them over cap.
    //
    //   The ceiling is a ceiling on TABS for that provider, so the standby pool
    //   has to be inside it. When the provider is full the warm tab is simply
    //   not worth opening: a caller will wait a few seconds for a real session
    //   instead, which is the trade the cap already makes. ]]
    const live = this.countLive(providerId);
    if (live + pool.length >= TAB_LIMITS.maxSessionsPerProvider) {
      logger.debug(
        `[Pool] Not warming ${providerId}: ${live} live + ${pool.length} standby already meets the cap of ${TAB_LIMITS.maxSessionsPerProvider}.`,
      );
      return;
    }

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
        session.pooledAt = Date.now(); // TabJanitor expires long-unused standbys
        pool.push(session);
        this._failedAt.delete(providerId); // clear any previous failure
        logger.info(`[Pool] ✨ ${providerId} standby tab is warm and ready.`);
      } else {
        await session.engine.close();
      }
    } catch (err) {
      logger.warn(`[Pool] Failed to warm up ${providerId}: ${err.message}`);
      this._failedAt.set(providerId, Date.now());
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
        logger.warn(
          `[Pool] Replenish failed for ${providerId}: ${err.message}`,
        ),
      );
      return session;
    }

    logger.debug(
      `[Pool] Pool empty for ${providerId}. Falling back to cold boot.`,
    );
    // Do NOT trigger replenish here — createSession() is about to do its own
    // cold boot. Firing replenish() concurrently would open a second tab for
    // the same provider. The pool is refilled naturally when the cold-booted
    // session is recycled back via _recycleOrClose on close.
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
