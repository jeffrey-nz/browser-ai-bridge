import process from "node:process";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { makeRl, askLine, closeRl } from "#app/ui/readline/index.js";
import {
  suspendDashboardForPrompt,
  resumeDashboardAfterPrompt,
} from "#app/ui/dashboard.js";
import { isWebMode } from "#web/mode.js";
import { renderDebugDump } from "../debugDump.js";

export async function promptForSelector(
  page,
  key,
  description,
  requireVisible,
) {
  suspendDashboardForPrompt();

  log(
    `\n${colors.bgRed(" ✘ CRITICAL ")} Could not find ${colors.bold(description)}.`,
  );

  await renderDebugDump(
    page,
    `Element not found -> ${description}`,
    "Element Not Found",
  );

  if (isWebMode() || !process.stdout.isTTY || !process.stdin.isTTY) {
    resumeDashboardAfterPrompt();
    throw new Error(
      `Automation aborted: Element not found -> ${description}. Running in non-interactive mode; cannot prompt for selector.`,
    );
  }

  const existingListeners = process.stdin.listeners("keypress");
  process.stdin.removeAllListeners("keypress");

  const rl = makeRl();
  try {
    while (true) {
      const answer = await askLine(
        rl,
        `👀 Inspect Chrome and enter a CSS selector (or 'q' to abort, 'r' to retry default locators): `,
      );
      const t = String(answer || "").trim();

      if (t.toLowerCase() === "q") {
        throw new Error(`Aborted: Element not found -> ${description}`);
      }

      if (t.toLowerCase() === "r") {
        return "RETRY";
      }

      if (!t) continue;

      const testLoc = page.locator(t).last();
      if (
        !requireVisible ||
        (await testLoc.isVisible({ timeout: 2000 }).catch(() => false))
      ) {
        return testLoc;
      }
      log(`  ${colors.yellow("⚠️")} Selector not found. Try again.`);
    }
  } finally {
    closeRl(rl);
    existingListeners.forEach((l) => process.stdin.on("keypress", l));
    resumeDashboardAfterPrompt();
  }
}
