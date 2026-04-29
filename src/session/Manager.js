import { SessionRegistry } from "./Registry.js";
import { createNewSession } from "./Creator.js";
import { sessionLogger } from "./Logger.js";
import { sessionPool } from "./Pool.js";
import { logger } from "#utils/logger.js";
import { getSessionState } from "../stalls.js";

// Sliding TTL - resets on every access. Sessions that haven't been touched
// for this long are swept; actively-used sessions survive indefinitely.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000;
const GC_INTERVAL_MS = 5 * 60 * 1000;

export class SessionManager {
  constructor() {
    this.registry = new SessionRegistry();
    // In test environment, skip the GC interval to allow Node to exit cleanly.
    if (process.env.NODE_ENV !== "test") {
      this.gcInterval = setInterval(
        () => this._cleanupStaleSessions(),
        GC_INTERVAL_MS,
      );
    } else {
      this.gcInterval = null;
    }
  }

  async _cleanupStaleSessions() {
    const now = Date.now();
    for (const session of this.registry.list()) {
      const lastUsed = session.lastUsedAt ?? session.createdAt.getTime();
      if (now - lastUsed > SESSION_TTL_MS && !session.locked) {
        logger.info(
          `[SessionManager] GC sweeping idle session: ${session.id} (idle ${Math.round((now - lastUsed) / 60000)}m)`,
        );
        await this.closeSession(session.id);
      }
    }
  }

  async createSession(providerId, mode = null) {
    let session = sessionPool.acquire(providerId);

    if (!session) {
      session = await createNewSession(providerId);
    }

    // Always start a fresh chat regardless of pool vs cold-boot origin.
    // Pool sessions are pre-warmed with startNewChat(), but may have accumulated
    // stale conversation state between warmup and acquisition (e.g. another
    // browser task ran in the same tab). Calling it here is cheap (~3s) and
    // guarantees a clean context for every caller.
    if (typeof session.engine?.startNewChat === "function") {
      await session.engine.startNewChat();
    }

    if (mode && typeof session.engine?.setMode === "function") {
      await session.engine
        .setMode(mode)
        .catch((err) =>
          logger.warn(
            `[SessionManager] setMode(${mode}) failed: ${err.message}`,
          ),
        );
    }

    // Default Gemini mode to 'pro' if none provided
    if (providerId === "gemini" && !mode) {
      mode = "pro";
      if (typeof session.engine?.setMode === "function") {
        await session.engine
          .setMode(mode)
          .catch((err) =>
            logger.warn(
              `[SessionManager] setMode(${mode}) failed: ${err.message}`,
            ),
          );
      }
    }

    logger.info(
      `[SessionManager] Session ${session.id} created for provider ${providerId} with mode ${mode || "none"}`,
    );

    this.registry.add(session.id, {
      ...session,
      locked: false,
      lastUsedAt: Date.now(),
    });

    return session.id;
  }

  logTranscript(sessionId, role, content, metadata = {}) {
    const session = this.registry.get(sessionId);
    if (session) {
      sessionLogger.logTranscript(session.logPath, role, content, metadata);
    }
  }

  getSession(sessionId) {
    const session = this.registry.get(sessionId);
    if (!session) return null;

    if (session.page.isClosed()) {
      this.closeSession(sessionId);
      return null;
    }

    // Sliding TTL: bump lastUsedAt on every access so active sessions
    // never expire while work is in progress.
    const now = Date.now();
    const lastUsed = session.lastUsedAt ?? session.createdAt.getTime();
    if (now - lastUsed > SESSION_TTL_MS) {
      logger.info(
        `[SessionManager] Session ${sessionId.slice(0, 8)} expired after ${Math.round((now - lastUsed) / 60000)}m idle.`,
      );
      this.closeSession(sessionId);
      return null;
    }
    session.lastUsedAt = now;

    return session;
  }

  async closeSession(sessionId) {
    const session = this.registry.get(sessionId);
    if (session) {
      sessionLogger.finalize(session.logPath);
      this.registry.delete(sessionId);
      await this._recycleOrClose(session);
      return true;
    }
    return false;
  }

  async _recycleOrClose(session) {
    const pool = sessionPool;
    const poolSize = Number(process.env.POOL_SIZE ?? 1);
    const currentPool = pool.warmSessions.get(session.providerId);
    const canRecycle =
      !pool.isShuttingDown &&
      currentPool &&
      currentPool.length < poolSize &&
      !pool._warming.has(session.providerId) &&
      !session.page?.isClosed();

    if (canRecycle) {
      // Return immediately to pool in its current state. createSession() always
      // calls startNewChat() on acquire, so no need to navigate now. Pushing
      // immediately (rather than after a navigation) prevents a concurrent
      // createSession from seeing an empty pool and spawning a new tab.
      currentPool.push(session);
      logger.info(
        `[SessionManager] ♻️ Recycled ${session.providerId} tab back to pool.`,
      );
    } else {
      if (session.engine && typeof session.engine.close === "function") {
        await session.engine
          .close()
          .catch((e) =>
            logger.error(`[SessionManager] Cleanup error: ${e.message}`),
          );
      }
    }
  }

  async closeAllSessions() {
    clearInterval(this.gcInterval);
    await sessionPool.shutdown();
    const sessions = this.registry.list();
    for (const session of sessions) {
      await this.closeSession(session.id);
    }
  }

  listSessions() {
    return this.registry.list().map((s) => ({
      id: s.id,
      providerId: s.providerId,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt ?? null,
      state: getSessionState(s.id),
    }));
  }
}
