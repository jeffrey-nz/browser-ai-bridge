export async function dumpPageHtml(page) {
  return await page
    .evaluate(() => {
      const root = document.body || document.documentElement;
      if (!root) return "No DOM root found.";

      const clone = root.cloneNode(true);

      clone
        .querySelectorAll("script, style, svg, img, path, meta, link, iframe")
        .forEach((el) => el.remove());
      return clone.innerHTML || clone.outerHTML;
    })
    .catch((e) => `Failed to extract HTML: ${e.message}`);
}
