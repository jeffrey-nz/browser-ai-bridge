import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

export async function stepDataExtraction(page, locs) {
  const selectors = [
    ...(locs.responseText ? locs.responseText.split(", ") : []),
    ...(locs.responseBlock ? locs.responseBlock.split(", ") : []),
  ];

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).last();
        const visible = await loc
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (!visible) continue;

        let text =
          (await loc.innerText({ timeout: 1000 }).catch(() => "")) ||
          (await loc.textContent({ timeout: 1000 }).catch(() => ""));

        if (text && text.trim().length > 0) {
          log(
            colors.dim(
              `       ↳ [${sel.split(",")[0].trim()}] "${text.slice(0, 60).replace(/\n/g, " ")}..."`,
            ),
          );
          return true;
        }
      } catch {}
    }
    await page.waitForTimeout(600);
  }

  return false;
}
