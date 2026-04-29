import { createSpinner } from "#app/ui/spinner.js";
import { extractViaClipboardAPI } from "./clipboard.js";
import { extractBlockViaDOM } from "./domFallback.js";

async function expandCodeBlock(block) {
  const expandButtons = block.locator(
    'button:has-text("Show more lines"), button:has-text("Expand"), .show-more-button',
  );

  const count = await expandButtons.count().catch(() => 0);
  if (count > 0) {
    try {
      await expandButtons.first().click({ timeout: 1500 });
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {}
  }
}

export async function extractCodeBlocks(page, codeBlocks, blockCount) {
  let combinedCode = "";
  let extracted = 0;
  let fallbacks = 0;
  const seenBlocks = new Set();

  const spinner = createSpinner(
    `Extracting ${blockCount} code blocks...`,
  ).start();

  for (let i = 0; i < blockCount; i++) {
    try {
      spinner.update(`Extracting block ${i + 1}/${blockCount}...`);

      const block = codeBlocks.nth(i);
      const isVisible = await block
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (!isVisible) continue;

      await expandCodeBlock(block);

      const copyBtn = block
        .locator('button#copy-button, button[aria-label*="Copy"]')
        .first();

      let text = await extractViaClipboardAPI(page, copyBtn);

      if (!text) {
        text = await extractBlockViaDOM(block);
        fallbacks++;
      }

      if (text) {
        const normalized = text.trim();

        if (!seenBlocks.has(normalized)) {
          seenBlocks.add(normalized);
          combinedCode += normalized + "\n\n";
          extracted++;
        }
      }
    } catch (err) {}
  }

  spinner.succeed(
    `Extracted ${extracted} unique blocks (${fallbacks} via DOM fallback)`,
  );
  return combinedCode.trim();
}
