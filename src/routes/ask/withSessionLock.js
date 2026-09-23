/**
 * withSessionLock — wraps a route body in the standard session-lock/cleanup pattern.
 *
 * Sets session.locked = true before calling fn, then in finally:
 *   - clears session.locked
 *   - calls cleanupAutoSession(autoCreated, session)
 *
 * Usage:
 *   return withSessionLock(session, autoCreated, async () => {
 *     // your route logic; return value is propagated
 *   });
 */

import { logger } from "#utils/logger.js";
import { cleanupAutoSession } from "./sessionHandler.js";

//[[ THE UNLOCK MUST HAPPEN EVEN WHEN THE CLEANUP CANNOT.
//   `cleanupAutoSession` → `closeSession` → `_recycleOrClose` drives Playwright
//   against the turn's page: navigating it back to a fresh chat, or closing it.
//   On a page whose JS thread is wedged — the ordinary state of a provider that
//   has just stalled or timed out — those calls do not come back. The await then
//   never returns, `session.locked = false` below it never runs, and the session
//   is locked for the lifetime of the process.
//
//   That is a permanent leak, not a slow one, because TabJanitor's per-provider
//   ceiling only evicts sessions that are NOT locked: every stale lock is a tab
//   it can never reclaim. Measured 2026-09-23 during a book run: qwen held 7
//   sessions against a cap of 3, and 9 tabs open on chat.qwen.ai, every session
//   idle (77s, 105s, 145s, 192s, 223s, 279s) and every one still "locked".
//
//   So the cleanup gets a budget and the unlock is unconditional. A cleanup that
//   overruns leaves the tab un-recycled, which is the lesser harm: with `locked`
//   false the janitor's over-cap and orphan rules can reclaim it on the next
//   sweep, which is precisely what they could not do before. ]]
const CLEANUP_BUDGET_MS = Number(process.env.SESSION_CLEANUP_TIMEOUT_MS ?? 15000);

export async function withSessionLock(session, autoCreated, fn) {
  session.locked = true;
  // TabJanitor: when the lock was taken, and whether this turn's caller has
  // gone (set by ask.js on req "close"). A new turn starts with a caller.
  session.lockedAt = Date.now();
  session.clientGone = false;
  try {
    return await fn();
  } finally {
    // Cleanup still runs first, so the pool cannot re-acquire a session whose
    // page is mid-recycle — but it can no longer hold the lock hostage.
    let timer;
    try {
      await Promise.race([
        cleanupAutoSession(autoCreated, session),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            logger.warn(
              `[SessionLock] cleanup for ${String(session?.id).slice(0, 8)} ` +
                `(${session?.providerId}) exceeded ${CLEANUP_BUDGET_MS}ms — unlocking anyway ` +
                "so the janitor can reclaim the tab.",
            );
            resolve();
          }, CLEANUP_BUDGET_MS);
        }),
      ]);
    } catch (err) {
      // A throwing cleanup must not skip the unlock either.
      logger.warn(
        `[SessionLock] cleanup for ${String(session?.id).slice(0, 8)} threw: ${err?.message} — unlocking anyway.`,
      );
    } finally {
      clearTimeout(timer);
      session.locked = false;
    }
  }
}
