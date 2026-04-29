import { getBrowserContext } from "../../../browser.js";

export async function validateBrowserConnection() {
  try {
    const { context } = await getBrowserContext();
    const pages = context ? context.pages() : [];

    const tabUrls = pages.map((p) => {
      try {
        return p.url();
      } catch {
        return "";
      }
    });

    const title = pages[0] ? await pages[0].title().catch(() => "") : "";

    return {
      ok: true,
      url: "cdp-connected",
      title,
      tabs: tabUrls.filter(Boolean),
    };
  } catch (err) {
    return {
      ok: false,
      reason: String(err?.message || err),
      url: "",
      title: "",
      tabs: [],
    };
  }
}
