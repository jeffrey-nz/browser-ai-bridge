import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export const REPORTS_DIR = path.join(process.cwd(), "reports");

function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

export function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

// Deletes audit artifacts from a previous run.
// If providerName is given, only clears that provider's files; otherwise clears all.
export function clearAuditArtifacts(providerName) {
  ensureDir();
  const prefix = providerName ? sanitizeName(providerName) : null;
  const files = fs.readdirSync(REPORTS_DIR);
  let removed = 0;
  for (const f of files) {
    if (!f.endsWith(".png") && !f.endsWith("-failure.html")) continue;
    if (prefix && !f.startsWith(prefix)) continue;
    fs.unlinkSync(path.join(REPORTS_DIR, f));
    removed++;
  }
  if (removed > 0) {
    const scope = prefix ? `for ${providerName}` : "from previous audit run";
    log(colors.dim(`  [IO] Cleared ${removed} artifact(s) ${scope}.`));
  }
}

// Saves a viewport screenshot after each step — gives a visual timeline that
// can be fed directly to Claude for analysis.
export async function saveStepScreenshot(
  page,
  providerName,
  stepIndex,
  stepName,
  result,
) {
  ensureDir();
  const provider = sanitizeName(providerName);
  // Step slug: strip leading "N. " numbering, lowercase, collapse spaces
  const slug = stepName
    .replace(/^\d+\.\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "")
    .slice(0, 40);
  const idx = String(stepIndex).padStart(2, "0");
  const filename = `${provider}-step-${idx}-${result}-${slug}.png`;
  const pngPath = path.join(REPORTS_DIR, filename);

  try {
    await page.screenshot({ path: pngPath, fullPage: false });
    log(colors.dim(`  [IO] Screenshot → ./reports/${filename}`));
  } catch (err) {
    log(colors.yellow(`  [IO] Screenshot skipped: ${err.message}`));
  }
}

export async function saveSnapshot(page, providerName) {
  ensureDir();
  const sanitizedName = sanitizeName(providerName);

  const htmlPath = path.join(REPORTS_DIR, `${sanitizedName}-failure.html`);
  const pngPath = path.join(REPORTS_DIR, `${sanitizedName}-failure.png`);

  try {
    const html = await page.content();
    if (html && html.trim().length > 0) {
      fs.writeFileSync(htmlPath, html, "utf8");
      log(
        colors.dim(
          `  [IO] DOM snapshot → ./reports/${sanitizedName}-failure.html`,
        ),
      );
    } else {
      log(
        colors.yellow(`  [IO] DOM snapshot was empty — skipping HTML write.`),
      );
    }
  } catch (err) {
    log(colors.red(`  [IO] Failed to save HTML snapshot: ${err.message}`));
  }

  try {
    await page.screenshot({ path: pngPath, fullPage: false });
    log(
      colors.dim(
        `  [IO] Failure screenshot → ./reports/${sanitizedName}-failure.png`,
      ),
    );
  } catch (err) {
    log(colors.red(`  [IO] Failed to save screenshot: ${err.message}`));
  }
}

export function saveReport(reportData) {
  ensureDir();

  const filePath = path.join(REPORTS_DIR, "audit-report.json");
  const withMeta = { auditedAt: new Date().toISOString(), ...reportData };
  fs.writeFileSync(filePath, JSON.stringify(withMeta, null, 2), "utf8");
  log(
    colors.green(
      `\n[IO] Final audit report saved to: ./reports/audit-report.json`,
    ),
  );
}
