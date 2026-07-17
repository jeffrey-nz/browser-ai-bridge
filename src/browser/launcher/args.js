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
    // --- Memory ceiling -------------------------------------------------
    // The bridge keeps one long-lived tab per AI provider, so Chrome's default
    // process-per-tab model spawned ~16 processes that sat resident for hours.
    // On a small-RAM machine that competes with the pipeline's own dictionary
    // load and pushes the whole box into swap (input freezes, forced reboots).
    // Same-site tabs share a renderer, and the count is capped. GPU/canvas are
    // deliberately left enabled — icon auto-extraction reads generated images
    // off a canvas and breaks under --disable-gpu.
    `--process-per-site`,
    `--renderer-process-limit=${process.env.CHROME_RENDERER_LIMIT || 4}`,
    `--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion`,
    `--disable-component-update`,
    `--disable-domain-reliability`,
    `--disable-client-side-phishing-detection`,
  ];

  const headlessMode = process.env.HEADLESS;
  if (process.env.CI === "true" || headlessMode === "true") {
    args.push("--headless=new");
  } else if (headlessMode === "offscreen") {
    // Offscreen mode: visible Chrome, but window positioned off-screen.
    // Use this when --headless=new triggers anti-bot prompts (Google account
    // chooser on Gemini, etc.) but you still don't want a window in the way.
    args.push("--window-position=-32000,-32000", "--window-size=1280,800");
  }

  return args;
}
