import { makeRl, promptChoice, closeRl } from "#app/ui/readline/index.js";
import { colors } from "#app/ui/colors.js";

export async function askForProviderToFix(snapshots) {
  const options = snapshots.map((filename) => {
    const base = filename.replace("-failure.html", "");
    return {
      label: `Fix ${colors.bold(base)} (Found snapshot: ${filename})`,
      value: { base, filename },
    };
  });

  options.push({ label: colors.dim("Cancel"), value: "CANCEL" });

  const rl = makeRl();
  const choice = await promptChoice(
    rl,
    "Which broken provider would you like to fix?",
    options,
  );
  closeRl(rl);

  return choice;
}
