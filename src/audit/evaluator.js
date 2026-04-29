import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

export async function evaluateComponent(componentName, actionFn) {
  try {
    const result = await actionFn();
    if (result) {
      log(`  [${colors.green("PASS")}] ${componentName}`);
      return true;
    } else {
      log(
        `  [${colors.yellow("WARN")}] ${componentName} - Action did not succeed normally, but did not crash.`,
      );
      return false;
    }
  } catch (err) {
    log(`  [${colors.red("FAIL")}] ${componentName} - Error: ${err.message}`);
    return false;
  }
}
