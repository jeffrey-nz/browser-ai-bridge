import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { checkForCopilotError } from "../errorChecker.js";

export function createErrorMonitor() {
  let errorDetectionCount = 0;

  return {
    async check(page) {
      const isError = await checkForCopilotError(page);
      if (isError) {
        errorDetectionCount++;

        if (errorDetectionCount > 2) {
          log(
            colors.yellow(
              "  (Confirmed 'Something went wrong' UI error. Aborting poll.)",
            ),
          );
          return true;
        }
      }
      return false;
    },
  };
}
