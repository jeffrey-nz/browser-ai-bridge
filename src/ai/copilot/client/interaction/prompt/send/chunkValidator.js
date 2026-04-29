import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { validateAndExtractResponse } from "../responseValidator/index.js";

export async function verifyAck(page, expectedAck) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const validation = await validateAndExtractResponse(page);

    if (!expectedAck || validation.action !== "success") {
      return { success: true, validation };
    }

    const actualText = (validation.text || "").toUpperCase();
    const target = expectedAck.toUpperCase();

    if (
      actualText.includes(target) ||
      (actualText.includes("PART") &&
        actualText.includes(target.split(" ").pop()))
    ) {
      return { success: true, validation };
    }

    if (attempt < 3) {
      log(
        colors.dim(
          `  [Verify] Target "${expectedAck}" not found (Attempt ${attempt}/3). Waiting...`,
        ),
      );
      await page.waitForTimeout(2000);
    }
  }

  log(
    colors.yellow(
      `  ⚠️ ACK mismatch. Expected "${expectedAck}", got: "${validation.text?.slice(0, 50)}..."`,
    ),
  );

  return {
    success: false,
    recovery: {
      action: "retry",
      reason: `ACK Mismatch: Expected ${expectedAck}`,
    },
  };
}
