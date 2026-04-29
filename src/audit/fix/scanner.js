import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPORTS_DIR = path.join(process.cwd(), "reports");

export function scanForFailures() {
  if (!fs.existsSync(REPORTS_DIR)) {
    return {
      error: "No reports directory found. Please run 'npm run audit' first.",
    };
  }

  const files = fs.readdirSync(REPORTS_DIR);
  const snapshots = files.filter((f) => f.endsWith("-failure.html"));

  if (snapshots.length === 0) {
    return { snapshots: [], reportData: {} };
  }

  let reportData = {};
  const reportPath = path.join(REPORTS_DIR, "audit-report.json");
  if (fs.existsSync(reportPath)) {
    try {
      reportData = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch (e) {}
  }

  return { snapshots, reportData, reportsDir: REPORTS_DIR };
}

export function loadSnapshotHtml(reportsDir, filename) {
  const snapshotPath = path.join(reportsDir, filename);
  return fs.readFileSync(snapshotPath, "utf8");
}
