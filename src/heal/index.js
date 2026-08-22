import { readFile } from "node:fs/promises";
import { logger } from "#utils/logger.js";
import { suggestSelectorsLocally } from "./localHealer.js";
import {
  extractCodeBlock,
  parseLocatorValues,
  patchLocatorsFile,
  PROVIDER_LOCATOR_PATHS,
  resolveLocatorsPath,
} from "./patcher.js";
import { setProviderOverride } from "./overrides.js";

// filePath here is repo-root-relative (a "src/..." string) because it's
// shown to the LLM and the human reading a self-heal prompt, not used to
// open the file directly — reads go through resolveLocatorsPath(providerId),
// which is also PROVIDER_LOCATOR_PATHS' one other reader (patcher.js's
// patchLocatorsFile). Deriving from PROVIDER_LOCATOR_PATHS instead of
// hand-typing a second copy is what T-121 found missing: the two tables
// disagreed about the "src/" prefix, and readCurrentLocators's own join
// (srcRoot + this "src/..." string) silently doubled it and never found a
// file, on all three providers, every time.
const PROVIDER_CONTEXT = {
  deepseek: {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    exportName: "DEEPSEEK_LOCATORS",
    filePath: `src/${PROVIDER_LOCATOR_PATHS.deepseek}`,
    description: `
The automation injects prompts into the DeepSeek chat UI and polls for completion.
Currently failing step: detecting when the AI has finished generating a response.

The polling logic:
1. Watches for the "stop generating" button to DISAPPEAR (selector: stopBtn)
2. Counts .ds-markdown elements - when count increases beyond initial count, a new response appeared
3. Waits for text to stabilise (same length for 4 consecutive 500ms polls)

The response was visually visible in the browser window but the selectors failed to detect it.`,
  },
  chatgpt: {
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    exportName: "CHATGPT_LOCATORS",
    filePath: `src/${PROVIDER_LOCATOR_PATHS.chatgpt}`,
    description:
      "Automation injects prompts and polls for stop button disappearance and response element.",
  },
  gemini: {
    name: "Gemini",
    url: "https://gemini.google.com/app",
    exportName: "GEMINI_LOCATORS",
    filePath: `src/${PROVIDER_LOCATOR_PATHS.gemini}`,
    description: "Automation injects prompts and polls for completion.",
  },
};

async function capturePageContext(page) {
  let screenshotBase64 = null;
  try {
    const buf = await page.screenshot({ type: "png", scale: "css" });
    screenshotBase64 = buf.toString("base64");
  } catch (e) {
    logger.warn(`[SelfHeal] Screenshot failed: ${e.message}`);
  }

  let htmlSnippet = "";
  try {
    const chatSelectors = [
      "#chat-container",
      "main",
      ".ds-chat-container",
      '[class*="chat"]',
      '[class*="conversation"]',
      "body",
    ];
    for (const sel of chatSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        const html = await el.innerHTML({ timeout: 2000 }).catch(() => "");
        if (html.length > 500) {
          htmlSnippet = html.slice(0, 12000);
          break;
        }
      }
    }
    if (!htmlSnippet) {
      htmlSnippet = (await page.content()).slice(0, 12000);
    }
  } catch (e) {
    logger.warn(`[SelfHeal] HTML capture failed: ${e.message}`);
  }

  return { screenshotBase64, htmlSnippet };
}

function buildPrompt(ctx, currentLocators, htmlSnippet) {
  return `## Failing Playwright Automation - Self-Healing Fix Request

Provider: ${ctx.name} (${ctx.url})
${ctx.description}

## Current Locators (${ctx.filePath})
These are the selectors currently in use:
\`\`\`javascript
${currentLocators}
\`\`\`

## Page HTML Snapshot (truncated)
Taken at the moment the automation was stuck:
\`\`\`html
${htmlSnippet || "(could not capture)"}
\`\`\`

## Your Task
1. Inspect the screenshot and HTML to find the correct CSS/Playwright selectors
2. Pay special attention to:
   - **stopBtn**: the button shown while the AI is generating (disappears when done)
   - **responseBlock**: the element containing the AI's response text
3. Output the COMPLETE updated \`${ctx.exportName}\` export

RESPOND WITH ONLY a single javascript code block like this:
\`\`\`javascript
// relative path: ${ctx.filePath}
export const ${ctx.exportName} = {
  // ... all properties, including unchanged ones
};
\`\`\``;
}

async function readCurrentLocators(providerId) {
  const fullPath = resolveLocatorsPath(providerId);
  if (!fullPath) return "(no locators path mapped)";
  try {
    return await readFile(fullPath, "utf8");
  } catch {
    return "(could not read current locators)";
  }
}

export { capturePageContext };

export async function selfHeal(session) {
  const providerId = session.providerId ?? "deepseek";
  const ctx = PROVIDER_CONTEXT[providerId] ?? PROVIDER_CONTEXT.deepseek;

  logger.info(
    `[SelfHeal] Starting for provider="${providerId}" session=${session.id.slice(0, 8)}`,
  );

  const { screenshotBase64, htmlSnippet } = await capturePageContext(
    session.page,
  );

  const currentLocators = await readCurrentLocators(providerId);

  let gptResponse;
  try {
    gptResponse = await suggestSelectorsLocally({
      providerContext: ctx,
      currentLocators,
      htmlSnippet,
      screenshotBase64,
    });
  } catch (err) {
    logger.error(`[SelfHeal] Local heal failed: ${err.message}`);
    return { success: false, message: `OpenAI error: ${err.message}` };
  }

  const codeBlock = extractCodeBlock(gptResponse);
  if (!codeBlock) {
    logger.warn("[SelfHeal] GPT did not return a code block");
    return { success: false, message: "GPT response contained no code block" };
  }

  const newLocators = parseLocatorValues(codeBlock);
  if (Object.keys(newLocators).length === 0) {
    return {
      success: false,
      message: "Could not parse locator values from GPT response",
    };
  }

  logger.info(
    `[SelfHeal] Parsed ${Object.keys(newLocators).length} locators: ${Object.keys(newLocators).join(", ")}`,
  );

  setProviderOverride(providerId, newLocators);

  patchLocatorsFile(providerId, codeBlock);

  return {
    success: true,
    message: `Self-heal complete. Updated ${Object.keys(newLocators).length} locators. Retrying turn...`,
    overrides: newLocators,
  };
}
