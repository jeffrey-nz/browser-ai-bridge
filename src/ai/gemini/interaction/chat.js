import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { GEMINI_LOCATORS } from "../locators.js";

export async function startNewChat(page) {
  // If already on the Gemini app root, the tab is already a blank slate — skip
  // navigation to avoid creating a new conversation entry in the sidebar.
  const url = page.url();
  const isAlreadyFresh =
    url === "https://gemini.google.com/app" ||
    url.startsWith("https://gemini.google.com/app?");

  if (!isAlreadyFresh) {
    log(`\n🧹 Starting a new chat context...`);
    await page.goto("https://gemini.google.com/app", {
      waitUntil: "domcontentloaded",
    });
  }

  // Wait for the input to be ready instead of a fixed timeout
  await page
    .locator(GEMINI_LOCATORS.inputBox)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => page.waitForTimeout(2000));

  // Dismiss any pop-up overlay. Two paths because Google's account chooser
  // lives in an iframe and is impervious to keyboard Escape:
  //   1) Escape — works for in-page overlays (Gemini upgrade prompt, side pane)
  //   2) Top-left mouse click — dismisses the iframe-hosted account chooser
  //      (clicking outside its bounds triggers Google's own outside-click
  //      handler).  Coordinates well inside the page header where nothing
  //      sensitive lives.
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(10, 10).catch(() => {});
  await page.waitForTimeout(300);

  if (isAlreadyFresh) {
    log(`  ${colors.green("✔")} Already on fresh context — reusing tab.`);
  } else {
    log(`  ${colors.green("✔")} Clean context established.`);
  }
}
