import { colors } from "#app/ui/colors.js";

export function formatDiagnostics(diag) {
  const diagLines = [];
  diagLines.push(
    `${colors.cyan("■ STOP BUTTON VISIBLE:")} ${diag.stopBtnVisible ? colors.red("YES (AI still generating)") : colors.green("no")}`,
  );
  if (diag.stopBtnVisible)
    diagLines.push(`  aria-label: "${diag.stopBtnAriaLabel}"`);
  diagLines.push(
    `${colors.cyan("■ REGENERATE BUTTON:")} ${diag.regenerateBtnPresent ? colors.green("present (response complete)") : colors.yellow("absent")}`,
  );
  diagLines.push(`${colors.cyan("■ AI MESSAGE COUNT:")} ${diag.messageCount}`);
  if (diag.lastAiText)
    diagLines.push(
      `${colors.cyan("■ LAST AI MESSAGE:")} "${diag.lastAiText.replace(/\n/g, " ")}"`,
    );

  diagLines.push("");
  if (diag.inputInfo) {
    diagLines.push(colors.cyan("■ INPUT BOX:"));
    diagLines.push(
      `  tag       : ${diag.inputInfo.tag} (id="${diag.inputInfo.id}")`,
    );
    diagLines.push(`  testid    : ${diag.inputInfo.dataTestId || "(none)"}`);
    diagLines.push(`  disabled  : ${diag.inputInfo.disabled}`);
    diagLines.push(`  readOnly  : ${diag.inputInfo.readOnly}`);
    diagLines.push(
      `  height    : ${diag.inputInfo.height}px  ➜ >22px means Lexical registered text`,
    );
    diagLines.push(`  value     : "${diag.inputInfo.value || "(empty)"}"`);
  } else {
    diagLines.push(colors.red("■ INPUT BOX: NOT FOUND"));
  }

  if (diag.sendBtnContainers?.length) {
    diagLines.push("");
    diagLines.push(
      colors.cyan(
        "■ SEND BUTTON CONTAINER (w-0 divs — should expand when text present):",
      ),
    );
    for (const c of diag.sendBtnContainers) {
      const expanded =
        c.width > 0
          ? colors.green(`[w=${c.width}px EXPANDED]`)
          : colors.red(`[w=0 COLLAPSED]`);
      diagLines.push(
        `  ${expanded} h=${c.height}px children=${c.childCount} "${c.innerText}"`,
      );
      diagLines.push(`    classes: ${c.classes}`);
    }
  }

  diagLines.push("");
  diagLines.push(colors.cyan("■ COMPOSER BUTTONS:"));
  if (diag.allComposerButtons?.length) {
    for (const b of diag.allComposerButtons) {
      const label = b.ariaLabel || b.title || b.text || b.id || "(unlabelled)";
      const size = `${b.width}×${b.height}`;
      const state = b.disabled
        ? colors.red("[disabled]")
        : b.hidden
          ? colors.yellow("[hidden]")
          : b.width === 0
            ? colors.yellow("[w=0]")
            : colors.green("[visible]");
      diagLines.push(`  ${state} ${label} (${size}) testid="${b.dataTestId}"`);
    }
  } else {
    diagLines.push("  (none found)");
  }

  return diagLines;
}
