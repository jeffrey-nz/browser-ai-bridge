/**
 * Shared setup-state singleton.
 *
 * authSequence.js writes to it; the /api/setup HTTP route reads from it.
 * The extension polls /api/setup and POSTs to /api/setup/confirm|skip
 * so the user can confirm providers from the VS Code sidebar instead of
 * typing in the terminal.
 */

class SetupState {
  constructor() {
    this.phase = "starting"; // "starting" | "waiting_confirm" | "ready"
    this.provider = null;    // { id, name, detected: bool } when waiting
    this._waiters = [];
  }

  setWaiting(provider) {
    this.phase = "waiting_confirm";
    this.provider = provider;
  }

  setReady() {
    this.phase = "ready";
    this.provider = null;
  }

  /** Resolves with "confirm" or "skip" once the extension responds. */
  waitForAction() {
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  confirm() { this._settle("confirm"); }
  skip()    { this._settle("skip");    }

  _settle(action) {
    this.phase = "starting";
    this.provider = null;
    this._waiters.shift()?.(action);
  }

  toJSON() {
    return { phase: this.phase, provider: this.provider };
  }
}

export const setupState = new SetupState();
