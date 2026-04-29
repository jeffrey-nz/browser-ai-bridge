// --- FILE START ---
// Relative Path: src/ai/copilot/client/interaction/prompt/responseValidator/domChecks.js

import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { checkForCopilotError } from "../errorChecker.js";
import { dismissSidePane } from "../../sidepane.js";
import { COPILOT_365_LOCATORS } from "../../../locators.js";

export async function checkDomForErrors(page, responseText = "") {
  if (await checkForCopilotError(page)) {
    log(
      `\n${colors.yellow("⚠️")} Copilot returned an error ("Something went wrong"). Forcing rotation...`,
    );
    return {
      action: "return",
      result: {
        ok: false,
        needsRotation: true,
        reason: "Copilot returned 'Something went wrong' error.",
      },
    };
  }

  const lastMessage = page.locator(COPILOT_365_LOCATORS.responseBlock).last();

  const cardSelector =
    COPILOT_365_LOCATORS.pageCardInChat || COPILOT_365_LOCATORS.pageWidget;
  const inChatCard = lastMessage.locator(cardSelector).first();
  const isCardInMessage = await inChatCard.isVisible().catch(() => false);

  const paneSelector =
    COPILOT_365_LOCATORS.pageSidePane || '[data-testid="pages-sidepane"]';
  const sidePane = page.locator(paneSelector).first();
  const isSidePaneOpen = await sidePane.isVisible().catch(() => false);

  // NOTE: `.fui-NavDrawer` is the standard Fluent UI navigation sidebar that is
  // visible on every page load — do NOT treat it as a widget indicator.  Only
  // a dedicated Pages side-pane or an in-message recall card are reliable signals.

  // Designer image embed: scoped to the message content area, not the action toolbar.
  // The "Edit in Pages" toolbar button is present on EVERY response and must NOT be
  // used as a widget indicator — only check for actual in-content embeds.
  const designerFrameSel =
    COPILOT_365_LOCATORS.designerImageFrame ||
    '[id^="designer-host-"], iframe[src*="designer.svc.cloud.microsoft"]';
  const designerFrame = lastMessage.locator(designerFrameSel).first();
  const hasDesignerImage = await designerFrame
    .isVisible({ timeout: 500 })
    .catch(() => false);

  const isPageCreated = isCardInMessage || isSidePaneOpen;

  const trimmed = responseText.trim();
  // Detect JSON content whether it is in a code fence, at the start of the
  // response, or following introductory prose (e.g. "Below is the array:\n[…]").
  const hasJsonBlock =
    responseText.includes("```json") ||
    responseText.includes("```") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    /[\n\r]\s*[\[{]/.test(responseText);

  if (hasDesignerImage && !hasJsonBlock) {
    log(
      `\n${colors.yellow("⚠️")} Copilot generated a Designer image instead of a text response. Requesting in-chat correction...`,
    );
    await dismissSidePane(page);
    return {
      action: "return",
      result: {
        ok: false,
        needsCorrection: true,
        reason:
          "The AI generated a Microsoft Designer image instead of a standard text/JSON response. " +
          "Do NOT generate images. Respond directly in the chat with plain text or a JSON array.",
      },
    };
  }

  if (isPageCreated && !hasJsonBlock) {
    const trigger = isCardInMessage
      ? "recall card in message"
      : isSidePaneOpen
        ? "pages-sidepane open"
        : "navigation drawer open";
    log(
      `\n${colors.yellow("⚠️")} Copilot generated a widget instead of a standard chat response (${trigger}). Requesting in-chat correction...`,
    );
    await dismissSidePane(page);
    return {
      action: "return",
      result: {
        ok: false,
        needsCorrection: true,
        reason:
          "The response was generated as a Canvas Page, Loop component, or Recall Card widget instead of a standard chat message. " +
          "This format cannot be parsed. Please respond directly in the chat with a JSON array.",
      },
    };
  }

  return null;
}
