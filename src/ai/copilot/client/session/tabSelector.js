import { isCopilotUrl } from "../navigation.js";
import { selectBrowserTab } from "#ai/shared/tabSelector.js";

export async function selectCopilotTab(context) {
  return selectBrowserTab({
    context,
    providerName: "Copilot",
    urlMatcher: isCopilotUrl,
  });
}
