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

import { cleanupAutoSession } from "./sessionHandler.js";

export async function withSessionLock(session, autoCreated, fn) {
  session.locked = true;
  try {
    return await fn();
  } finally {
    // Cleanup must finish before clearing locked so the session pool can't
    // re-acquire this session while its page is still being closed/recycled.
    await cleanupAutoSession(autoCreated, session);
    session.locked = false;
  }
}
