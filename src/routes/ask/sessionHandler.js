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
    await session.page.close().catch(() => {});
    await sessionManager.closeSession(session.id);
  }
}
