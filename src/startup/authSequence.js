import process from "node:process";
import { PROVIDERS_TO_LOGIN } from "./providers.js";
import { promptChoice, makeRl, closeRl } from "#app/ui/readline/index.js";
import { colors } from "#app/ui/colors.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import {
  claimExternalPage,
  releaseExternalPage,
} from "#ai/shared/BaseProvider.js";
import { setupState } from "../setup/state.js";

export async function runLoginSequence(context) {
  console.log("\n=============================================");
  console.log("   AI Provider Authentication & Tab Setup");
  console.log("=============================================");

  const isNonInteractive = !process.stdout.isTTY || !process.stdin.isTTY;

  // BROWSER_AI_ASSUME_LOGGED_IN=1 — trust that every provider is already signed
  // in: skip the per-provider login detection and the Ready/Skip confirmation
  // entirely, and don't prompt for setup scope. Tabs are still opened/reused so
  // the providers are primed, just never verified.
  const assumeLoggedIn = /^(1|true|yes|on)$/i.test(
    process.env.BROWSER_AI_ASSUME_LOGGED_IN || "",
  );

  const rl = isNonInteractive || assumeLoggedIn ? null : makeRl();

  if (assumeLoggedIn) {
    console.log(
      colors.yellow(
        "   ⚡ BROWSER_AI_ASSUME_LOGGED_IN set — assuming all providers are logged in (no verification).",
      ),
    );
  }

  let providersToRun = PROVIDERS_TO_LOGIN;

  // Skip scope selection when BROWSER_AI_PROVIDERS is already set — the caller
  // has already made the selection, asking again is redundant.
  const scopeAlreadyChosen = !!process.env.BROWSER_AI_PROVIDERS;

  if (!isNonInteractive && !scopeAlreadyChosen && !assumeLoggedIn) {
    const scopeOptions = [
      { label: colors.green("Configure ALL providers"), value: "ALL" },
      ...PROVIDERS_TO_LOGIN.map((p) => ({
        label: `Configure only ${colors.bold(p.name)}`,
        value: p.id,
      })),
    ];

    const scope = await promptChoice(
      rl,
      "Which providers do you want to set up?",
      scopeOptions,
      { defaultOption: 1 },
    );

    if (scope !== "ALL") {
      const chosen = PROVIDERS_TO_LOGIN.find((p) => p.id === scope);
      providersToRun = chosen ? [chosen] : PROVIDERS_TO_LOGIN;
      for (const p of PROVIDERS_TO_LOGIN) {
        if (p.id !== scope && PROVIDER_CONFIG[p.id]) {
          PROVIDER_CONFIG[p.id].disabled = true;
        }
      }
    }
  }

  for (const provider of providersToRun) {
    console.log(`\n-> Configuring ${colors.bold(provider.name)}...`);

    try {
      let pages = context.pages();
      let page = pages.find((p) => {
        try {
          const url = p.url();
          return url.includes(new URL(provider.url).hostname);
        } catch {
          return false;
        }
      });

      if (!page || page.isClosed()) {
        console.log(
          `   [New Tab] Opening dedicated tab for ${provider.name}...`,
        );
        page = await context.newPage();
        await page
          .goto(provider.url, { waitUntil: "domcontentloaded", timeout: 30000 })
          .catch(() => {});

        const landedUrl = page.url();
        if (landedUrl === "about:blank" || landedUrl === "") {
          console.log(
            `   [Retry] Page is still about:blank — retrying navigation...`,
          );
          await page
            .goto(provider.url, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            })
            .catch(() => {});
        }
      }

      claimExternalPage(page);
      await page.bringToFront().catch(() => {});

      const isDetected = assumeLoggedIn
        ? true
        : await page
            .locator(provider.readySelector)
            .first()
            .isVisible({ timeout: 2500 })
            .catch(() => false);

      if (assumeLoggedIn) {
        console.log(
          colors.green(`   [Assumed] Skipping login check — treating as ready.`),
        );
      } else if (isDetected) {
        console.log(colors.green(`   [Detected] Interface found.`));
      } else {
        console.log(
          colors.yellow(
            `   [Pending] Manual login or navigation may be required in Chrome.`,
          ),
        );
      }

      if (isNonInteractive || assumeLoggedIn) {
        const reason = assumeLoggedIn ? "Assume-logged-in" : "Non-interactive";
        console.log(
          `   ${colors.yellow("⚡")} [Auto] ${reason} mode — assuming ${provider.name} is ready.`,
        );
        releaseExternalPage(page);
        continue;
      }

      let skip = false;

      if (scopeAlreadyChosen) {
        // Launched by VS Code extension — confirm via the HTTP setup API.
        console.log(
          `   ${colors.yellow("⏳")} [Extension] Waiting for confirmation from VS Code sidebar…`,
        );
        setupState.setWaiting({
          id: provider.id,
          name: provider.name,
          detected: isDetected,
        });
        const action = await setupState.waitForAction();
        releaseExternalPage(page);
        skip = action === "skip";
      } else {
        // Interactive terminal mode.
        const choice = await promptChoice(
          rl,
          `Action for ${colors.bold(provider.name)}:`,
          [
            { label: colors.green("Confirm Ready"), value: "READY" },
            {
              label: colors.red("Skip (Disable for this session)"),
              value: "SKIP",
            },
          ],
          { defaultOption: 1 },
        );
        releaseExternalPage(page);
        skip = choice === "SKIP";
      }

      if (skip) {
        console.log(
          `   ${colors.red("✖")} Skipping ${provider.name}. Disabling route.`,
        );
        if (PROVIDER_CONFIG[provider.id])
          PROVIDER_CONFIG[provider.id].disabled = true;
        await page.close().catch(() => {});
      } else {
        console.log(
          `   ${colors.green("✔")} ${provider.name} verified and ready.`,
        );
      }
    } catch (err) {
      console.log(
        `   ${colors.red("✖")} Error configuring ${provider.name}: ${err.message}`,
      );
      if (PROVIDER_CONFIG[provider.id])
        PROVIDER_CONFIG[provider.id].disabled = true;
    } finally {
      if (typeof page !== "undefined" && page) releaseExternalPage(page);
    }
  }

  if (rl) closeRl(rl);

  console.log("\n=============================================");
  console.log("   Setup Complete. Active providers ready.");
  console.log("=============================================\n");
}
