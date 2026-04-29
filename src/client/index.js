/**
 * BrowserAIClient — programmatic client for the browser-ai-bridge server.
 *
 * Usage:
 *   import { BrowserAIClient } from "browser-ai-bridge/client";
 *   const client = new BrowserAIClient({ baseUrl: "http://localhost:3333" });
 *   const reply = await client.ask({ provider: "chatgpt", prompt: "Hello!" });
 */

export class BrowserAIClient {
  /**
   * @param {{ baseUrl?: string, timeout?: number }} [options]
   */
  constructor({ baseUrl = "http://localhost:3333", timeout = 420_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeout = timeout;
  }

  async _request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const init = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error ?? json.message ?? `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  /** Check whether the server is ready. */
  health() {
    return this._request("GET", "/api/ping");
  }

  /** List all open sessions. */
  listSessions() {
    return this._request("GET", "/api/sessions");
  }

  /**
   * Send a prompt and wait for the AI response.
   * @param {{ provider?: string, sessionId?: string, prompt: string, label?: string, mode?: string }} opts
   */
  ask(opts) {
    return this._request("POST", "/api/ask", opts);
  }

  /**
   * Send a prompt without waiting for the AI response.
   * @param {{ provider?: string, sessionId?: string, prompt: string }} opts
   */
  prompt(opts) {
    return this._request("POST", "/api/prompt", opts);
  }

  /**
   * Open a dedicated session for a provider and return a BrowserAISession.
   * @param {string} provider
   * @param {{ mode?: string }} [opts]
   */
  async createSession(provider, { mode } = {}) {
    const data = await this._request("POST", "/api/sessions", {
      provider,
      mode,
    });
    const session = new BrowserAISession(this, data.sessionId, provider);
    session.maxPromptChars = data.maxPromptChars ?? null;
    return session;
  }

  /**
   * Close a session by ID.
   * @param {string} sessionId
   */
  closeSession(sessionId) {
    return this._request("DELETE", `/api/sessions/${sessionId}`);
  }

  /**
   * Get the status of a session.
   * @param {string} sessionId
   */
  sessionStatus(sessionId) {
    return this._request("GET", `/api/sessions/${sessionId}/status`);
  }
}

export class BrowserAISession {
  /**
   * @param {BrowserAIClient} client
   * @param {string} id
   * @param {string} provider
   */
  constructor(client, id, provider) {
    this.client = client;
    this.id = id;
    this.provider = provider;
  }

  /**
   * Send a prompt and wait for the AI response.
   * @param {string} prompt
   * @param {{ label?: string, mode?: string }} [opts]
   */
  ask(prompt, opts = {}) {
    return this.client.ask({
      sessionId: this.id,
      provider: this.provider,
      prompt,
      ...opts,
    });
  }

  /**
   * Send a prompt without waiting for the AI response.
   * @param {string} prompt
   */
  prompt(prompt) {
    return this.client.prompt({
      sessionId: this.id,
      provider: this.provider,
      prompt,
    });
  }

  /** Get the current status of this session. */
  status() {
    return this.client.sessionStatus(this.id);
  }

  /** Close this session. */
  close() {
    return this.client.closeSession(this.id);
  }
}
