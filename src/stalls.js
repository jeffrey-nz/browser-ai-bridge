import { eventBus } from "#web/eventBus.js";

const activeSessions = new Set();

const pendingControls = new Map();

const stallMap = new Map();

const STALL_TIMEOUT_MS = 10 * 60 * 1000;

function emitSync(sessionId) {
  eventBus.emit("sync_event", {
    type: "session_state_change",
    payload: { sessionId, state: getSessionState(sessionId) },
    timestamp: Date.now(),
  });
}

export function markActive(sessionId) {
  activeSessions.add(sessionId);
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
