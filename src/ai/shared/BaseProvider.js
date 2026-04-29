import { logger } from "#utils/logger.js";
import { getBrowserContext } from "../../browser.js";

// Tracks pages that are currently owned by an active provider instance OR the
// auth setup sequence. Prevents createSession() from stealing a tab that is
// already in use (including tabs opened by authSequence.js during setup).
const _ownedPages = new WeakSet();

// Called by authSequence.js to protect setup tabs from being stolen by a
// concurrent createSession() call (e.g. the icon generator running alongside
// the auth wizard). The caller must call releaseExternalPage() when done.
export function claimExternalPage(page) {
  _ownedPages.add(page);
}

export function releaseExternalPage(page) {
  _ownedPages.delete(page);
}

export class BaseProvider {
  constructor(providerName, urlMatcher, baseUrl) {
    this.providerName = providerName;
    this.urlMatcher = urlMatcher;
    this.baseUrl = baseUrl;
    this.page = null;
  }

  async initialize() {
    const { context } = await getBrowserContext();

    // Reuse an already-loaded tab for this provider if one exists,
    // rather than always navigating a fresh about:blank page (which can
    // time-out when Chrome is already busy with open sessions).
    const existingPages = context.pages();
    const matchingPages = existingPages.filter((p) => {
      try {
        return this.urlMatcher(p.url()) && !_ownedPages.has(p);
      } catch {
        return false;
      }
    });

    if (matchingPages.length > 0) {
      this.page = matchingPages[0];
      _ownedPages.add(matchingPages[0]);
      if (matchingPages.length > 1) {
        logger.info(
          `[${this.providerName}] Closing ${matchingPages.length - 1} duplicate unowned tab(s)`,
        );
        for (let i = 1; i < matchingPages.length; i++) {
          matchingPages[i].close().catch(() => {});
        }
      } else {
        logger.info(
          `[${this.providerName}] Reusing existing tab: ${matchingPages[0].url().slice(0, 80)}`,
        );
      }
    } else {
      this.page = await context.newPage();
      _ownedPages.add(this.page);
      try {
        await this.page.goto(this.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch (err) {
        logger.warn(
          `[${this.providerName}] Navigation warning: ${err.message}`,
        );
        // After a timeout the page may still be loading. Check the final URL —
        // if we landed on about:blank the provider won't work, so retry once.
        const currentUrl = this.page.url();
        if (currentUrl === "about:blank" || currentUrl === "") {
          logger.warn(
            `[${this.providerName}] Page is still about:blank — retrying navigation...`,
          );
          try {
            await this.page.goto(this.baseUrl, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
          } catch (retryErr) {
            logger.warn(
              `[${this.providerName}] Retry navigation warning: ${retryErr.message}`,
            );
          }
        }
      }
    }

    await this.page.bringToFront();
    await this.onTabSelected();

    logger.info(`🌿 Ready to start AI loop (${this.providerName})`);
    return this;
  }

  async onTabSelected() {}

  async close() {
    if (this.page) {
      _ownedPages.delete(this.page);
      if (!this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
    }
    logger.debug(`[${this.providerName}] Tab closed.`);
  }

  async startNewChat() {
    throw new Error(`[${this.providerName}] startNewChat() not implemented`);
  }

  async setMode(mode) {
    throw new Error(`[${this.providerName}] setMode() not implemented`);
  }

  async sendPromptAndWait(text, label) {
    throw new Error(
      `[${this.providerName}] sendPromptAndWait() not implemented`,
    );
  }

  async sendPromptOnly(text) {
    throw new Error(`[${this.providerName}] sendPromptOnly() not implemented`);
  }
}
