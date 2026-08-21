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
// (survives the drain) and resets only on confirmed evidence the browser can
// still produce a live page: a brand-new session actually completing
// createNewSession() (Creator.js).
let lastUnexpectedPageCloseAt = null;

/** Call when a registered session's page is found closed without this
 * process having asked for that close — GC sweep or getSession() self-prune. */
export function recordUnexpectedPageClose() {
  lastUnexpectedPageCloseAt = Date.now();
}

/** Call when a brand-new session finishes initializing — evidence the
 * browser can still open and drive a live page. */
export function recordFreshSessionCreated() {
  lastUnexpectedPageCloseAt = null;
}

/** Epoch ms of the last unexpected page-close discovery, or null if none is
 * outstanding (never happened, or resolved by a subsequent fresh session). */
export function getLastUnexpectedPageCloseAt() {
  return lastUnexpectedPageCloseAt;
}
