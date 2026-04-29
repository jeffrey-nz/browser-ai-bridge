import { ensureLocator } from "../ensureLocator.js";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

async function ensureFocusable(locator) {
  await locator.waitFor({ state: "visible", timeout: 12000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true }).catch(() => {});
  await locator.focus().catch(() => {});
}

export async function getChatInputArea(page) {
  const loc = await ensureLocator(page, "input_box", "the chat text area", () =>
    page
      .locator(
        [
          "#m365-chat-editor-target-element",
          '[data-lexical-editor="true"]',
          "#userInput",
          '[data-testid="composer-input"]',
          'textarea[aria-label*="Copilot" i]',
          "textarea",
          '[contenteditable="true"]',
          "#searchbox",
          '[role="textbox"]',
        ].join(", "),
      )
      .filter({ visible: true })
      .last(),
  );

  try {
    await ensureFocusable(loc);
  } catch (e) {
    log(
      colors.yellow(
        `  [Input] Warning: could not fully focus input (${e.message}). Continuing...`,
      ),
    );
  }

  return loc;
}
