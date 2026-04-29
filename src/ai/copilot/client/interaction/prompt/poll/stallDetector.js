import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function checkStallCondition(
  isGenerating,
  lastChangeTime,
  stopBtn,
) {
  if (isGenerating && Date.now() - lastChangeTime > 60000) {
    log(
      colors.yellow(
        "\n  (Generation appears stalled. Attempting to stop and finalize...)",
      ),
    );
    await stopBtn.click().catch(() => {});
    return true;
  }
  return false;
}
