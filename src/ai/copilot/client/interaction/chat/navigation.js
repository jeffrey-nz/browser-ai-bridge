import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { ensureLocator } from "../ensureLocator.js";
import { isCopilot365Url } from "../../navigation.js";
import { renderDebugDump } from "../debugDump.js";

const COPILOT365_BASE_URL = "https://m365.cloud.microsoft/chat";

// Matches localStorage keys that should NOT be cleared — auth tokens (MSAL,
// session cookies, nonces, account hints) are stored in localStorage and must
// survive between navigations to keep the user signed in.
const AUTH_KEY_RE =
  /msal|\.token|idtoken|account|\.oid|\.tid|\.exp|authority|nonce|login_hint|state_/i;
// Matches localStorage keys that hold conversation-routing state.  These are
// safe to wipe so the SPA doesn't restore the previous conversation.
const CONV_KEY_RE = /conversation|thread|chat|copilot|message|history/i;

/**
 * Hard-navigates to the Copilot 365 base URL.  More reliable than clicking
 * the "New Chat" button when the page is in a broken or stalled state because
 * it completely tears down the current page context rather than relying on UI
 * elements that may be unresponsive.
 *
 * After the initial navigation (which lets the SPA bootstrap so we can access
 * its localStorage), we clear any conversation-routing keys so the SPA won't
 * redirect back to the previous conversation on the second navigation.  Auth
 * keys (MSAL tokens etc.) are explicitly excluded.
 */
export async function hardNavigateToCopilot365(page) {
  log(colors.dim(`  [Chat] Hard-navigating to Copilot 365 base URL...`));

  // First pass — navigate so we can access the page's localStorage.
  await page
    .goto(COPILOT365_BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    })
    .catch((err) => {
      log(colors.yellow(`  [Chat] Hard navigate warning: ${err.message}`));
    });

  // Brief pause for the SPA to bootstrap (it may redirect to the last conversation).
  await page.waitForTimeout(1500);

  // Clear conversation-routing state from localStorage so the next navigation
  // starts a fresh chat instead of restoring the previous one.
  const cleared = await page
    .evaluate(
      ({ convRe, authRe }) => {
        const conv = new RegExp(convRe, "i");
        const auth = new RegExp(authRe, "i");
        const toDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          const v = localStorage.getItem(k) || "";
          const isConvRelated =
            conv.test(k) || v.includes("conversation/") || v.includes("/chat/");
          if (isConvRelated && !auth.test(k)) {
            toDelete.push(k);
          }
        }
        toDelete.forEach((k) => localStorage.removeItem(k));
        return toDelete;
      },
      {
        convRe: CONV_KEY_RE.source,
        authRe: AUTH_KEY_RE.source,
      },
    )
    .catch(() => []);

  if (cleared.length > 0) {
    log(
      colors.dim(
        `  [Chat] Cleared ${cleared.length} conversation localStorage key(s): ${JSON.stringify(cleared)}`,
      ),
    );
    // Second pass — SPA now has no conversation to restore, so it starts fresh.
    await page
      .goto(COPILOT365_BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      .catch((err) => {
        log(colors.yellow(`  [Chat] Re-navigate warning: ${err.message}`));
      });
  } else {
    log(
      colors.dim(
        `  [Chat] No conversation localStorage keys found — SPA may use server-side routing.`,
      ),
    );
  }

  // Give the SPA time to bootstrap after navigation.
  await page.waitForTimeout(3000);
}

/**
 * After a hard-navigate to the Copilot 365 base URL, the SPA may still
 * restore the last conversation via server-side routing.  This function
 * checks whether we ended up at a conversation URL and, if so, tries to
 * click "New Conversation" using Playwright's native locators (which pierce
 * shadow DOM).  If the URL is already at the base (localStorage was cleared
 * successfully), it skips the button-click and returns immediately.
 */
async function startFreshCopilot365Conversation(page) {
  const urlBefore = (() => {
    try {
      return page.url();
    } catch {
      return "?";
    }
  })();
  log(colors.dim(`  [Chat] URL after navigate: ${urlBefore.slice(0, 100)}`));

  // If localStorage clear worked, the SPA didn't restore an old conversation —
  // we're already at a fresh context.  No button click needed.
  const isAtConversation = urlBefore.includes("/conversation/");
  if (!isAtConversation) {
    log(
      colors.dim(
        `  [Chat] SPA started fresh (no conversation URL) — skipping new-conversation click.`,
      ),
    );
    return;
  }

  // Playwright's getByRole() and locator() pierce shadow DOM — use them rather
  // than page.evaluate() / document.querySelectorAll() which cannot.
  // Try strategies from most to least specific, stopping at the first one
  // that finds a visible element within a short timeout.
  const strategies = [
    () =>
      page
        .getByRole("button", { name: /new.*(conversation|chat|topic)/i })
        .first(),
    () =>
      page
        .getByRole("link", { name: /new.*(conversation|chat|topic)/i })
        .first(),
    () =>
      page
        .getByRole("menuitem", { name: /new.*(conversation|chat|topic)/i })
        .first(),
    () =>
      page
        .locator(
          '[aria-label*="New conversation" i], [aria-label*="New chat" i], [aria-label*="New topic" i]',
        )
        .first(),
    () =>
      page
        .locator('[title*="New conversation" i], [title*="New chat" i]')
        .first(),
    () => page.locator("button").filter({ hasText: /^new$/i }).first(),
    () =>
      page
        .locator("button")
        .filter({ hasText: /new.*(conversation|chat)/i })
        .first(),
  ];

  let clicked = false;
  for (const getLocator of strategies) {
    try {
      const loc = getLocator();
      const visible = await loc.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) continue;

      const label =
        (await loc.getAttribute("aria-label").catch(() => null)) ??
        (await loc.getAttribute("title").catch(() => null)) ??
        (await loc.textContent().catch(() => null));
      log(
        colors.dim(
          `  [Chat] Found new-conv button: "${String(label || "")
            .trim()
            .slice(0, 60)}"`,
        ),
      );

      await loc.click({ force: true, timeout: 5000 }).catch(async () => {
        await loc.focus().catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
      });
      clicked = true;
      break;
    } catch {
      // Strategy failed — try next
    }
  }

  if (!clicked) {
    log(
      colors.yellow(
        `  [Chat] New conversation button not found — running diagnostic dump.`,
      ),
    );

    // ── Interactive element scan (full document) ────────────────────────────
    const allInteractive = await page
      .evaluate(() => {
        const els = [
          ...document.querySelectorAll(
            "button, a[href], [role='button'], [role='menuitem'], [role='link'], [role='tab'], [tabindex]",
          ),
        ];
        return els.slice(0, 60).map((el) => ({
          tag: el.tagName,
          role: el.getAttribute("role"),
          ariaLabel: el.getAttribute("aria-label"),
          title: el.getAttribute("title"),
          testId: el.getAttribute("data-testid"),
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          visible: el.offsetParent !== null,
        }));
      })
      .catch(() => []);
    log(
      colors.yellow(
        `  [Chat] All interactive elements (up to 60, light DOM only):\n` +
          allInteractive
            .map(
              (e, i) =>
                `    [${i}] ${e.tag} role=${e.role} aria=${e.ariaLabel} title=${e.title} ` +
                `testId=${e.testId} visible=${e.visible} text="${e.text}"`,
            )
            .join("\n"),
      ),
    );

    // ── localStorage dump ───────────────────────────────────────────────────
    const lsDump = await page
      .evaluate(() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) out[k] = (localStorage.getItem(k) || "").slice(0, 120);
        }
        return out;
      })
      .catch(() => ({}));
    log(
      colors.yellow(
        `  [Chat] localStorage (${Object.keys(lsDump).length} keys):\n` +
          Object.entries(lsDump)
            .map(([k, v]) => `    ${k} = ${v}`)
            .join("\n"),
      ),
    );

    // ── Full page HTML snapshot + composer diagnostics ──────────────────────
    await renderDebugDump(
      page,
      "startNewChat: new-conversation button not found",
      "Copilot 365 New Chat",
    );
    return;
  }

  await page.waitForTimeout(1000);
  const urlAfter = (() => {
    try {
      return page.url();
    } catch {
      return "?";
    }
  })();
  log(
    colors.dim(
      `  [Chat] New conversation started (Copilot 365). URL: ${urlAfter.slice(0, 100)}`,
    ),
  );

  // If the URL is still at the same old conversation, the button click didn't
  // navigate away.  Log a warning so we know the click had no effect.
  if (urlAfter.includes("/conversation/") && urlAfter === urlBefore) {
    log(
      colors.yellow(
        `  [Chat] URL unchanged after new-conversation click — SPA may use server-side routing. ` +
          `Proceeding anyway; localStorage was already cleared in hardNavigateToCopilot365.`,
      ),
    );
  }
}

export async function triggerNewChatUI(page) {
  // For Copilot 365, prefer a hard navigate over clicking the "New Chat"
  // button.  The button is unreliable when the page is stalled or in an error
  // state; a fresh navigation is guaranteed to produce a clean context.
  const url = (() => {
    try {
      return page.url();
    } catch {
      return "";
    }
  })();

  if (isCopilot365Url(url)) {
    await hardNavigateToCopilot365(page);
    // After hard-navigating, Copilot 365 restores the previous conversation via
    // SPA routing.  Click "New Conversation" to guarantee a fresh chat context.
    await startFreshCopilot365Conversation(page);
    return true;
  }

  const newChatBtn = await ensureLocator(
    page,
    "new_chat_btn",
    "the 'New Chat' / 'New Topic' button",
    () =>
      page
        .locator(
          [
            '[data-testid="newChatButton"]',
            '[data-automation-id="newChatButton"]',
            '[data-testid="sidebar-new-conversation-nav-item"]',
            'button[aria-label="New topic"]',
            'button[aria-label="New chat"]',
            'button[aria-label*="New" i]',
            ".new-topic-button",
            'a[aria-label*="New" i]',
          ].join(", "),
        )
        .first(),
    { optional: true },
  );

  if (newChatBtn) {
    await newChatBtn.click({ force: true, timeout: 6000 }).catch(async () => {
      log(
        colors.dim(`  [Chat] Click failed, attempting keyboard activation...`),
      );
      await newChatBtn.focus().catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
    });
    return true;
  }

  return false;
}

export async function reloadChatContext(page) {
  // For Copilot 365, reload by navigating to the base URL rather than
  // page.reload() — this avoids reloading a stalled or error-state URL.
  const url = (() => {
    try {
      return page.url();
    } catch {
      return "";
    }
  })();

  if (isCopilot365Url(url)) {
    await hardNavigateToCopilot365(page);
    return;
  }

  log(colors.dim(`  [Chat] Resetting context via page reload...`));
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);
}
