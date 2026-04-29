import { dismissGroundingMenus } from "./menus.js";
import { softDismissWidgets } from "./softDismiss.js";
import { hardDismissWidgets } from "./hardDismiss.js";

export { dismissGroundingMenus };

export async function dismissSidePane(page) {
  let dismissed = await softDismissWidgets(page);

  const domCleared = await hardDismissWidgets(page);

  return dismissed || domCleared;
}
