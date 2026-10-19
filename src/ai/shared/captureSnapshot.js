import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log } from "#app/ui/log.js";

// ── SNAPSHOTS LIVE ON THE DATA DRIVE ─────────────────────────────────────────
//
// One HTML page per failure, 1-2 MB each, and nothing prunes them: by 2026-09-28
// ~/reader-scripts/snapshots and ~/browser-ai-bridge/snapshots held 4.2 GB of the
// system disk between them, on a Mac that has twice run out of space mid-build.
// They are only ever read by hand, so they go where the space is:
//   BRIDGE_SNAPSHOT_DIR, if set;
//   else "/Volumes/External Drive/<repo>/snapshots" when that drive is mounted
//        (<repo> = the directory the process runs from, so reader-scripts' land
//        beside its DATA_ROOT);
//   else ./snapshots, as before — a failure is never lost for want of a drive.
const DATA_DRIVE = process.env.DATA_DRIVE || "/Volumes/External Drive";

export function snapshotDir(cwd = process.cwd()) {
  if (process.env.BRIDGE_SNAPSHOT_DIR) return path.resolve(process.env.BRIDGE_SNAPSHOT_DIR);
  if (fs.existsSync(DATA_DRIVE)) return path.join(DATA_DRIVE, path.basename(cwd), "snapshots");
  return path.resolve(cwd, "snapshots");
}

export async function capturePageSnapshot(page, label = "Automation Failure") {
  try {
    const html = await page.content();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `copilot-helper-snapshot-${timestamp}.html`;
    const dir = snapshotDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filepath = path.resolve(dir, filename);
    fs.writeFileSync(filepath, html, "utf8");
    log(
      `  [Snapshot] ${label}: page HTML saved to ${filepath} (${html.length} bytes).`,
    );
  } catch (err) {
    log(`  [Snapshot] Failed to capture page HTML: ${err.message}`);
  }
}
