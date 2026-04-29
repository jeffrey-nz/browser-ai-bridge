import { logger } from "#utils/logger.js";

export class NetworkMonitor {
  constructor(page, endpointPattern) {
    this.page = page;
    this.endpointPattern = endpointPattern;
    this.activeRequests = new Set();
    this.lastCompletionTime = Date.now();

    this.handleRequest = this.handleRequest.bind(this);
    this.handleRequestFinished = this.handleRequestFinished.bind(this);
    this.handleRequestFailed = this.handleRequestFailed.bind(this);

    this.page.on("request", this.handleRequest);
    this.page.on("requestfinished", this.handleRequestFinished);
    this.page.on("requestfailed", this.handleRequestFailed);
  }

  handleRequest(request) {
    if (
      request.url().includes(this.endpointPattern) &&
      request.method() === "POST"
    ) {
      this.activeRequests.add(request);
      logger.trace(`[NetworkMonitor] Stream started: ${request.url()}`);
    }
  }

  handleRequestFinished(request) {
    if (this.activeRequests.has(request)) {
      this.activeRequests.delete(request);
      this.lastCompletionTime = Date.now();
      logger.trace(`[NetworkMonitor] Stream finished: ${request.url()}`);
    }
  }

  handleRequestFailed(request) {
    if (this.activeRequests.has(request)) {
      this.activeRequests.delete(request);
      logger.warn(
        `[NetworkMonitor] Stream failed or aborted: ${request.url()}`,
      );
    }
  }

  isStreamActive() {
    return this.activeRequests.size > 0;
  }

  getTimeSinceLastCompletion() {
    return Date.now() - this.lastCompletionTime;
  }

  cleanup() {
    this.page.off("request", this.handleRequest);
    this.page.off("requestfinished", this.handleRequestFinished);
    this.page.off("requestfailed", this.handleRequestFailed);
    this.activeRequests.clear();
  }
}
