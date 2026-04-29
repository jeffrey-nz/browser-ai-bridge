import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { dismissSidePane } from "./sidepane.js";
import { isCopilot365Url } from "../navigation.js";
import { renderDebugDump } from "./debugDump.js";
import { waitForComposerReady } from "./chat/composer.js";
import { triggerNewChatUI, reloadChatContext } from "./chat/navigation.js";

export async function startNewChat(page) {
  log(`\n✨ Starting a new chat context...`);

  const url = (() => {
    try {
      return page.url();
    } catch {
      return "";
    }
  })();

  const is365 = isCopilot365Url(url);

  try {
    await dismissSidePane(page);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  } catch {}

  const uiResetSuccess = await triggerNewChatUI(page);
  if (!uiResetSuccess) {
    await reloadChatContext(page);
  }

  // First attempt: wait for composer to be ready
  try {
    await waitForComposerReady(page);
    log(
      `  ${colors.green("✅")} Clean context established.${is365 ? " (Copilot365)" : ""}`,
    );
    return;
  } catch (_firstErr) {
    // Composer not ready yet — try a full page reload as a second chance
    log(colors.yellow(`  [Chat] Composer not ready after new-chat click. Reloading page and retrying...`));
  }

  await reloadChatContext(page);

  try {
    await waitForComposerReady(page);
    log(
      `  ${colors.green("✅")} Clean context established after reload.${is365 ? " (Copilot365)" : ""}`,
    );
  } catch (err) {
    await renderDebugDump(
      page,
      err.message,
      is365 ? "Copilot365 New Chat Failure" : "Copilot New Chat Failure",
    );
    throw new Error(
      `Failed to verify new chat started after reload. (${err.message})`,
    );
  }
}
