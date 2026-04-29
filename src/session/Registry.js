export class SessionRegistry {
  constructor() {
    this.sessions = new Map();
  }

  add(id, session) {
    const staleSessionId = session.page?.__sessionId;
    if (staleSessionId && this.sessions.has(staleSessionId)) {
      console.warn(
        `[Registry] Evicting stale session ${staleSessionId} from page before binding new session ${id}`,
      );
      const stale = this.sessions.get(staleSessionId);
      if (stale?.page) delete stale.page.__sessionId;
      this.sessions.delete(staleSessionId);
    }

    session.page.__sessionId = id;
    this.sessions.set(id, session);
  }

  get(id) {
    return this.sessions.get(id);
  }

  delete(id) {
    const session = this.sessions.get(id);
    if (session?.page) {
      delete session.page.__sessionId;
    }
    return this.sessions.delete(id);
  }

  list() {
    return [...this.sessions.values()];
  }
}
