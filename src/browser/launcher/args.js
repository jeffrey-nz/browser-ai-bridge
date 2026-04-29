// --- FILE START ---
// Relative Path: src/browser/launcher/args.js
import process from "node:process";

export function getChromeArgs(port, userDataDir) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=${userDataDir}`,
    `--remote-allow-origins=*`,
    `--no-first-run`,
    `--no-default-browser-check`,
    `--disable-extensions`,
    `--disable-background-networking`,
    `--disable-background-timer-throttling`,
    `--disable-backgrounding-occluded-windows`,
    `--disable-renderer-backgrounding`,
    `--disable-hang-monitor`,
    `--disable-prompt-on-repost`,
    `--disable-sync`,
    `--metrics-recording-only`,
    `--no-sandbox`,
    `--disable-setuid-sandbox`,
    `--password-store=basic`,
    `--use-mock-keychain`,
    `--export-tagged-pdf`,
  ];

  if (process.env.CI === "true" || process.env.HEADLESS === "true") {
    args.push("--headless=new");
  }

  return args;
}
