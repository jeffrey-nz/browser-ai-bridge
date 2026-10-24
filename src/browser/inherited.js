//[[ A TAB THAT WAS HERE BEFORE THIS BRIDGE STARTED IS NOT THE BRIDGE'S.
//
//   The bridge's Chrome is shared. On 2026-10-25 it held 17 pages: two of the
//   bridge's, two kimi.ai pages no bridge session owned, and Stripe, Gumroad,
//   itch.io, Play Console and App Store Connect tabs that OTHER sessions were
//   signed in to. A restarted bridge treated everything already open as fair game
//   in three places:
//     - connect closed every blank tab (another session's tab, about to load);
//     - BaseProvider.initialize adopted ANY unowned tab on a provider's domain
//       and closed the "duplicates" (a person's chatgpt.com tab is a duplicate);
//     - the janitor closed any provider-domain tab no session held, after 150 s
//       (it cannot tell its predecessor's tab from somebody else's).
//
//   So pages that exist when the bridge connects are INHERITED, and an inherited
//   page is never closed, adopted or navigated — unless it carries the bridge's
//   provenance mark. The mark is a sessionStorage key the bridge stamps on every
//   tab it opens or adopts. sessionStorage belongs to the tab and its origin, so it
//   survives the bridge restarting and the page reloading, and a tab someone else
//   opened on the same site does not have it. A tab the bridge opened before this
//   mark existed reads as inherited and is left alone: a few idle tabs after one
//   restart, rather than one closed tab that was somebody's work. ]]

export const BRIDGE_MARK_KEY = "__browserAiBridgeOwned";

const inherited = new WeakSet();

/** True for a page that predates this bridge and has not been proven ours. */
export function isInheritedPage(page) {
  return inherited.has(page);
}

/** Stamp a page the bridge opened or adopted, so a later bridge can tell. */
export async function stampBridgeOwned(page) {
  if (!page || page.isClosed?.()) return;
  await withTimeout(
    page.evaluate((k) => {
      try {
        sessionStorage.setItem(k, String(Date.now()));
      } catch {
        /* opaque origin (about:blank) — nothing to stamp yet */
      }
    }, BRIDGE_MARK_KEY),
    2000,
  ).catch(() => {});
}

async function readMark(page) {
  return withTimeout(
    page.evaluate((k) => {
      try {
        return !!sessionStorage.getItem(k);
      } catch {
        return false;
      }
    }, BRIDGE_MARK_KEY),
    2000,
  ).catch(() => false);
}

/**
 * Classify the pages already open when the bridge connects. Only provider-domain
 * pages are read for the mark (nothing else is ever a candidate to touch), and a
 * page that cannot be read stays inherited.
 *
 * @param {Array} pages            context.pages() at connect
 * @param {(url:string)=>string|null} providerForUrl
 * @returns {Promise<{ inherited: number, provenOurs: number }>}
 */
export async function classifyExistingPages(pages, providerForUrl) {
  let provenOurs = 0;
  await Promise.all(
    pages.map(async (page) => {
      let url = "";
      try {
        url = page.url();
      } catch {
        /* detached */
      }
      if (providerForUrl(url) && (await readMark(page))) {
        provenOurs++;
        return;
      }
      inherited.add(page);
    }),
  );
  return { inherited: pages.length - provenOurs, provenOurs };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}
