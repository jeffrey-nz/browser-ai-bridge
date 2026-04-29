import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log } from "#app/ui/log.js";

export async function capturePageSnapshot(page, label = "Automation Failure") {
  try {
    const html = await page.content();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `copilot-helper-snapshot-${timestamp}.html`;
    const snapshotDir = path.resolve(process.cwd(), "snapshots");
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const filepath = path.resolve(snapshotDir, filename);
    fs.writeFileSync(filepath, html, "utf8");
    log(`  [Snapshot] Page HTML saved to snapshots/${filename} (${html.length} bytes).`);
  } catch (err) {
    log(`  [Snapshot] Failed to capture page HTML: ${err.message}`);
  }
}
