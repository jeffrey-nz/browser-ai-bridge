import { eventBus } from "#web/eventBus.js";

// Map, not Set (T-003): also carries WHEN a session became active, so a
// caller can ask "how long has this session been mid-turn" without any
// operator involvement — the thing stalledSessions could never answer for
// an unattended caller, because registerStall() below is only ever reached
// from the interactive stall-resolution path (stallLoop.js).
const activeSessions = new Map();

const pendingControls = new Map();

const stallMap = new Map();

const STALL_TIMEOUT_MS = 10 * 60 * 1000;

// T-003: measured, not typed. 64 non-error turns across this board's
// recorded reports/vision-probe/*.json corpus range 7.6s to 68.2s
// (p50 29s, p90 53s, p95 58s, p99/max 68.2s) — see the crew board ticket for
// the exact figures. 120s clears the entire observed healthy range with
// ~1.8x margin over the slowest healthy turn on record, while still
// flagging well before a poll's own hard ceiling (300s in this codebase).
// Override for testing/tuning only — same pattern as BROWSER_DEADLOCK_TIMEOUT_MS
// and CDP_BIND_TIMEOUT_MS elsewhere in this codebase. The measured default above
// is what ships; this just lets a live demonstration not need a genuine 2-minute
// hang to prove the mechanism moves.
export const LONG_RUNNING_THRESHOLD_MS = process.env.LONG_RUNNING_THRESHOLD_MS
  ? Number(process.env.LONG_RUNNING_THRESHOLD_MS)
  : 120 * 1000;

function emitSync(sessionId) {
  eventBus.emit("sync_event", {
    type: "session_state_change",
    payload: { sessionId, state: getSessionState(sessionId) },
    timestamp: Date.now(),
  });
}

export function markActive(sessionId) {
  activeSessions.set(sessionId, Date.now());
  pendingControls.delete(sessionId);
  emitSync(sessionId);
}

export function markActivePreserving(sessionId) {
  const pending = pendingControls.get(sessionId);
  markActive(sessionId);
  if (pending) pendingControls.set(sessionId, pending);
}

export function markInactive(sessionId) {
  activeSessions.delete(sessionId);
  emitSync(sessionId);
}

export function isActive(sessionId) {
  return activeSessions.has(sessionId);
}

// How long a session has been continuously active (mid-turn), or null if it
// isn't active right now. Independent of registerStall/the operator path —
// this is the number an unattended caller can actually use.
export function activeDurationMs(sessionId) {
  const startedAt = activeSessions.get(sessionId);
  return startedAt === undefined ? null : Date.now() - startedAt;
}

export function isLongRunning(
  sessionId,
  thresholdMs = LONG_RUNNING_THRESHOLD_MS,
) {
  const d = activeDurationMs(sessionId);
  return d !== null && d > thresholdMs;
}

export function sendActiveControl(sessionId, result) {
  if (!activeSessions.has(sessionId)) return false;
  pendingControls.set(sessionId, result);
  eventBus.emit(`session_control:${sessionId}`, result);
  emitSync(sessionId);
  return true;
}

export function registerStall(sessionId) {
  const pending = pendingControls.get(sessionId);
  if (pending) {
    pendingControls.delete(sessionId);
    return Promise.resolve(pending);
  }

  // If there is already an active stall promise for this session (e.g. from a
  // previous retry cycle that was never resolved), clean it up first so we
  // don't leak timer handles or leave orphaned resolvers.
  const existing = stallMap.get(sessionId);
  if (existing) {
    stallMap.delete(sessionId);
    // Don't call existing() here - that would resolve the old promise with
    // "skip" and cause the caller to skip unexpectedly.
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stallMap.delete(sessionId);
      resolve({ action: "skip" });
      emitSync(sessionId);
    }, STALL_TIMEOUT_MS);

    stallMap.set(sessionId, (result) => {
      clearTimeout(timer);
      stallMap.delete(sessionId);
      resolve(result);
    });
    emitSync(sessionId);
  });
}

export function resolveStall(sessionId, result) {
  const fn = stallMap.get(sessionId);
  if (!fn) return false;
  fn(result);
  emitSync(sessionId);
  return true;
}

export function isStalled(sessionId) {
  return stallMap.has(sessionId);
}

export function getSessionState(sessionId) {
  if (isActive(sessionId)) return "active";
  if (isStalled(sessionId)) return "stalled";
  return "idle";
}

// Called by the session Manager when a session is closed/removed so that
// orphaned entries from crashed sessions don't accumulate indefinitely.
export function cleanupSession(sessionId) {
  activeSessions.delete(sessionId);
  pendingControls.delete(sessionId);
  const fn = stallMap.get(sessionId);
  if (fn) {
    stallMap.delete(sessionId);
    fn({ action: "skip" }); // resolve any waiting stall promise so callers don't hang
  }
}
