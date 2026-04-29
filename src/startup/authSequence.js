import process from "node:process";
import { PROVIDERS_TO_LOGIN } from "./providers.js";
import { promptChoice, makeRl, closeRl } from "#app/ui/readline/index.js";
import { colors } from "#app/ui/colors.js";
import { PROVIDER_CONFIG } from "../config/providers.js";
import { claimExternalPage, releaseExternalPage } from "#ai/shared/BaseProvider.js";

export async function runLoginSequence(context) {
  console.log("\n=============================================");
  console.log("   AI Provider Authentication & Tab Setup");
  console.log("=============================================");

  const isNonInteractive = !process.stdout.isTTY || !process.stdin.isTTY;
  const rl = isNonInteractive ? null : makeRl();

  let providersToRun = PROVIDERS_TO_LOGIN;

  if (!isNonInteractive) {
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
      {
        defaultOption: 1,
      },
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

        // If Chrome was busy and the page is still about:blank, retry once
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

      // Protect this tab from being stolen by a concurrent createSession()
      // call (e.g. the icon generator running in another terminal while the
      // auth wizard is waiting for user input).
      claimExternalPage(page);

      await page.bringToFront().catch(() => {});

      const isDetected = await page
        .locator(provider.readySelector)
        .first()
        .isVisible({ timeout: 2500 })
        .catch(() => false);

      if (isDetected) {
        console.log(colors.green(`   [Detected] Interface found.`));
      } else {
        console.log(
          colors.yellow(
            `   [Pending] Manual login or navigation may be required in Chrome.`,
          ),
        );
      }

      if (isNonInteractive) {
        console.log(
          `   ${colors.yellow("⚡")} [Auto] Non-interactive mode detected. Assuming ${provider.name} is ready.`,
        );
        releaseExternalPage(page);
        continue;
      }

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

      if (choice === "SKIP") {
        console.log(
          `   ${colors.red("✖")} Skipping ${provider.name}. Disabling route.`,
        );
        if (PROVIDER_CONFIG[provider.id]) {
          PROVIDER_CONFIG[provider.id].disabled = true;
        }

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
      // Always release the claim so BaseProvider can reuse the tab if needed.
      if (typeof page !== "undefined" && page) releaseExternalPage(page);
    }
  }

  if (rl) closeRl(rl);

  console.log("\n=============================================");
  console.log("   Setup Complete. Active providers ready.");
  console.log("=============================================\n");
}
