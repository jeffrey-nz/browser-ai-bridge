import { isCopilot365Url } from "../navigation.js";
import { selectBrowserTab } from "#ai/shared/tabSelector.js";

export async function selectCopilot365Tab(context) {
  return selectBrowserTab({
    context,
    providerName: "Copilot 365",
    urlMatcher: isCopilot365Url,
  });
}
