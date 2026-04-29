import process from "node:process";
import { execSync } from "node:child_process";

export function findChromeExecutable() {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  } else if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  } else {
    const bins = [
      "google-chrome",
      "google-chrome-stable",
      "chromium-browser",
      "chromium",
    ];
    return (
      bins.find((b) => {
        try {
          execSync(`which ${b}`, { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      }) || "google-chrome"
    );
  }
}
