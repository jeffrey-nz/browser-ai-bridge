export const BrowserState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
};

export const internalState = {
  browser: null,
  browserContext: null,
  status: BrowserState.DISCONNECTED,
  connectionPromise: null,
  chromePid: null,
};

export function setBrowserState(status, browser = null, context = null) {
  internalState.status = status;
  internalState.browser = browser;
  internalState.browserContext = context;
  if (status === BrowserState.DISCONNECTED) {
    internalState.connectionPromise = null;
  }
}
