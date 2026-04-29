import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export async function handleAck(page, validation, chunkIndex) {
  const ackText = validation.text.trim();

  if (ackText.length > 20 && !ackText.includes(`ACK ${chunkIndex + 1}`)) {
    log(
      colors.yellow(
        `  ⚠️  AI provided unexpected response during chunking. Proceeding with caution...`,
      ),
    );
  }

  await page.waitForTimeout(2500);
}
