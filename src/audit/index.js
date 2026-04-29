import process from "node:process";
import { connectToBrowser } from "../browser.js";
import {
  makeRl,
  askLine,
  closeRl,
  promptChoice,
} from "#app/ui/readline/index.js";
import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";
import { AUDIT_PROVIDERS } from "./providers.js";
import { runMotionTest } from "./motion.js";
import { saveReport, saveSnapshot, clearAuditArtifacts } from "./io.js";

async function runAudit() {
  const isCi = process.argv.includes("--ci") || process.env.CI === "true";
  const providerArg = (() => {
    const idx = process.argv.indexOf("--provider");
    return idx !== -1 ? process.argv[idx + 1] : null;
  })();

  log(colors.cyan("\n╔════════════════════════════════════════╗"));
  log(colors.cyan("║    AI Browser Infrastructure Audit     ║"));
  log(colors.cyan("╚════════════════════════════════════════╝"));

  const { context } = await connectToBrowser();
  const rl = isCi || providerArg ? null : makeRl();

  let providersToAudit = AUDIT_PROVIDERS;

  if (providerArg) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const needle = normalize(providerArg);
    const match = AUDIT_PROVIDERS.filter((p) =>
      normalize(p.name).includes(needle),
    );
    if (match.length === 0) {
      log(colors.red(`  No provider matching "${providerArg}". Available: ${AUDIT_PROVIDERS.map((p) => p.name).join(", ")}`));
      process.exit(1);
    }
    providersToAudit = match;
    log(colors.yellow(`  Running single-provider audit: ${match.map((p) => p.name).join(", ")}`));
  } else if (!isCi) {
    const scopeOptions = [
      { label: colors.green("Audit ALL providers"), value: "ALL" },
      ...AUDIT_PROVIDERS.map((p) => ({
        label: `Audit only ${colors.bold(p.name)}`,
        value: p.name,
      })),
    ];

    const scope = await promptChoice(
      rl,
      "Which providers do you want to audit?",
      scopeOptions,
      { defaultOption: 1 },
    );

    providersToAudit =
      scope === "ALL"
        ? AUDIT_PROVIDERS
        : AUDIT_PROVIDERS.filter((p) => p.name === scope);
  }

  if (providerArg) {
    for (const p of providersToAudit) clearAuditArtifacts(p.name);
  } else {
    clearAuditArtifacts();
  }

  const tableReport = {};
  const fullReport = {};
  let auditFailed = false;

  for (const provider of providersToAudit) {
    log(`\n${colors.magenta("─────────────────────────────────────────")}`);
    log(`  ${colors.bold(`Auditing: ${provider.name}`)}`);
    log(`${colors.magenta("─────────────────────────────────────────")}`);

    const page = await context.newPage();

    try {
      await page.goto(provider.url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.bringToFront();

      if (isCi || providerArg) {
        log(
          colors.yellow(
            `  [${isCi ? "CI" : "Provider"} Mode] Waiting 5s for ${provider.name} to settle...`,
          ),
        );
        await page.waitForTimeout(5000);
      } else {
        const ready = await askLine(
          rl,
          `\nEnsure ${colors.bold(provider.name)} is logged in and ready.\nPress Enter to run, or type 's' to skip: `,
        );

        if (ready.trim().toLowerCase() === "s") {
          log(colors.yellow(`  Skipping ${provider.name}.`));
          tableReport[provider.name] = { Status: "Skipped" };
          fullReport[provider.name] = { Status: "Skipped", steps: [] };
          await page.close();
          continue;
        }
      }

      const { passed, total, failedAt, steps } = await runMotionTest(page, provider);

      if (passed !== total) {
        auditFailed = true;
      }

      const summary = {
        "Steps Checked": total,
        "Steps Passed": passed,
        Status: passed === total ? "✅ OK" : `❌ ${passed}/${total} passed`,
      };

      tableReport[provider.name] = summary;
      fullReport[provider.name] = {
        ...summary,
        ...(failedAt ? { failedAt } : {}),
        steps,
      };
    } catch (err) {
      auditFailed = true;
      log(
        colors.red(
          `  [ERROR] Failed to load ${provider.name}: ${err.message}`,
        ),
      );
      await saveSnapshot(page, provider.name).catch(() => {});
      tableReport[provider.name] = { Status: `❌ Navigation Error` };
      fullReport[provider.name] = { Status: `❌ Navigation Error`, failedAt: "Navigation", steps: [] };
    } finally {
      await page.close().catch(() => {});
    }
  }

  if (rl) closeRl(rl);

  log(colors.cyan("\n╔════════════════════════════════════════╗"));
  log(colors.cyan("║             Audit Report               ║"));
  log(colors.cyan("╚════════════════════════════════════════╝"));
  console.table(tableReport);

  saveReport(fullReport);

  if (isCi && auditFailed) {
    log(colors.red("\n[CI] Audit failed. Exiting with code 1."));
    process.exit(1);
  }

  process.exit(0);
}

runAudit().catch((err) => {
  log(colors.red("\nAudit crashed:"));
  console.error(err);
  process.exit(1);
});
