// T-023: attachedPages (src/routes/health.js) reads a registered session's
// page.isClosed() directly, so it is accurate for as long as a dead session
// stays in the registry — a window bounded by whichever comes first of
// GC_INTERVAL_MS (Manager.js._cleanupStaleSessions) or the next getSession()
// call touching it (Manager.js.getSession() self-prunes on access). Once
// that session is gone, attachedPages goes back to reading `sessions` — 0 —
// which is character-for-character what a healthy idle bridge also reads.
//
// This module records the DISCOVERY of an unexpected page death — an edge,
// not a level — so /api/ping can still say something once the registry has
// drained past the point attachedPages could see anything. It is sticky
// (survives the drain) and resets on confirmed evidence the browser can
// still produce a live page: ANY session — pool hit or cold boot — that
// finishes SessionManager.createSession() successfully (Manager.js, right
// after startNewChat() succeeds), not only a cold boot through Creator.js —
// a pool hit never reaches Creator.js at all, and a collapse recorded while
// the bridge was already back to serving working turns from the pool would
// otherwise stay set indefinitely (T-023's rejection round).
let lastUnexpectedPageCloseAt = null;

/** Call when a registered session's page is found closed without this
 * process having asked for that close — GC sweep or getSession() self-prune. */
export function recordUnexpectedPageClose() {
  lastUnexpectedPageCloseAt = Date.now();
}

/** Call when a session finishes SessionManager.createSession() successfully
 * — pool hit or cold boot, either is evidence the browser can still open
 * and drive a live page. */
export function recordFreshSessionCreated() {
  lastUnexpectedPageCloseAt = null;
}

/** Epoch ms of the last unexpected page-close discovery, or null if none is
 * outstanding (never happened, or resolved by a subsequent fresh session). */
export function getLastUnexpectedPageCloseAt() {
  return lastUnexpectedPageCloseAt;
}
