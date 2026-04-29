import { eventBus } from "#web/eventBus.js";

export class PollAbortController {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.aborted = false;
    this.controlAborted = false;

    this.abortHandler = () => {
      this.aborted = true;
    };
    this.controlAbortHandler = () => {
      this.controlAborted = true;
      this.aborted = true;
    };

    eventBus.once("abort_requested", this.abortHandler);
    if (this.sessionId) {
      eventBus.once(
        `session_control:${this.sessionId}`,
        this.controlAbortHandler,
      );
    }
  }

  check() {
    if (this.controlAborted) {
      throw Object.assign(new Error("CONTROL_ABORT"), { controlAbort: true });
    }
    if (this.aborted) {
      throw new Error("Aborted (Web UI)");
    }
  }

  cleanup() {
    eventBus.off("abort_requested", this.abortHandler);
    if (this.sessionId) {
      eventBus.off(
        `session_control:${this.sessionId}`,
        this.controlAbortHandler,
      );
    }
  }
}
