import { sessionManager } from "../../session/index.js";

export async function resolveSession(sessionId, provider, mode) {
  let session;
  let autoCreated = false;

  if (sessionId) {
    session = sessionManager.getSession(sessionId);
    if (!session) {
      return { error: "Session expired or invalid", status: 404 };
    }
  } else {
    try {
      const newId = await sessionManager.createSession(provider, mode);
      session = sessionManager.getSession(newId);
      autoCreated = true;
      if (!session) {
        return {
          error: "Session created but immediately unavailable (page closed)",
          status: 500,
        };
      }
    } catch (err) {
      return { error: `Failed to create session: ${err.message}`, status: 500 };
    }
  }

  if (session.locked) {
    return {
      error: "Session is busy processing another prompt",
      status: 409,
      autoCreated,
      session,
    };
  }

  return { session, autoCreated };
}

export async function cleanupAutoSession(autoCreated, session) {
  if (autoCreated && session) {
    // Let closeSession handle page lifecycle via _recycleOrClose — closing the
    // page here before closeSession runs prevents the pool from recycling the
    // tab, causing a new browser tab to be opened for every subsequent request.
    await sessionManager.closeSession(session.id);
  }
}
