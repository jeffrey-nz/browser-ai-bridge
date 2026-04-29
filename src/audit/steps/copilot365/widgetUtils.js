import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

export async function waitForWidget(page, widgetSel, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  const parts = widgetSel.split(",").map((s) => s.trim());
  while (Date.now() < deadline) {
    for (const sel of parts) {
      const visible = await page
        .locator(sel)
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (visible) return sel;
    }
    await page.waitForTimeout(600);
  }
  return null;
}

export async function discoverButtonsNearWidget(page, widgetSel) {
  const buttons = await page
    .evaluate((sel) => {
      const widget = document.querySelector(sel);
      if (!widget) return [];
      const container =
        widget.closest(
          '[data-testid="pages-sidepane"], [class*="sidepane"], [class*="panel"], [role="dialog"]',
        ) || widget.parentElement?.parentElement;
      if (!container) return [];
      return Array.from(container.querySelectorAll("button")).map((btn) => ({
        ariaLabel: btn.getAttribute("aria-label") || "",
        dataTestId: btn.getAttribute("data-testid") || "",
        title: btn.getAttribute("title") || "",
        text: (btn.innerText || btn.textContent || "").trim().slice(0, 60),
        id: btn.id || "",
      }));
    }, widgetSel)
    .catch(() => []);

  if (buttons.length > 0) {
    log(colors.cyan(`\n  ↳ All buttons inside widget container:`));
    for (const btn of buttons) {
      if (!btn.ariaLabel && !btn.dataTestId && !btn.text && !btn.title)
        continue;
      log(
        colors.dim(
          `       aria-label="${btn.ariaLabel}" | data-testid="${btn.dataTestId}" | title="${btn.title}" | text="${btn.text}"`,
        ),
      );
    }
  } else {
    log(
      colors.yellow(
        `\n  ↳ No buttons found inside widget container via JS walk.`,
      ),
    );
  }
}

export async function probeSelectors(page, candidates, label) {
  const found = [];
  for (const sel of candidates) {
    const visible = await page
      .locator(sel)
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false);
    if (visible) {
      const ariaLabel = await page
        .locator(sel)
        .first()
        .getAttribute("aria-label")
        .catch(() => "");
      const testId = await page
        .locator(sel)
        .first()
        .getAttribute("data-testid")
        .catch(() => "");
      found.push({ sel, ariaLabel, testId });
    }
  }

  if (found.length > 0) {
    log(colors.green(`\n  ✔ ${label} — ${found.length} matched:`));
    for (const b of found) {
      log(
        colors.dim(
          `       ${b.sel}  [aria-label="${b.ariaLabel}"] [data-testid="${b.testId}"]`,
        ),
      );
    }
  } else {
    log(colors.yellow(`\n  ⚠ ${label} — no matches found.`));
  }
  return found;
}

export async function tryDismiss(page, candidates, widgetSel) {
  const parts = widgetSel ? widgetSel.split(",").map((s) => s.trim()) : [];

  for (const sel of candidates) {
    try {
      await page.locator(sel).first().click({ force: true, timeout: 2000 });
      await page.waitForTimeout(800);

      let stillVisible = false;
      for (const s of parts) {
        stillVisible = await page
          .locator(s)
          .first()
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (stillVisible) break;
      }

      if (!stillVisible) {
        log(colors.green(`\n  ✔ Widget dismissed via: ${sel}`));
        return sel;
      }
    } catch {}
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
  log(colors.yellow(`\n  ⚠ Dismiss failed — used Escape fallback.`));
  return null;
}
