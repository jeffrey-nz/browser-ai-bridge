import { AUDIT_PROVIDERS } from "../providers.js";

export function generateLlmPrompt(baseName, htmlContent, reportData) {
  const provider = AUDIT_PROVIDERS.find(
    (p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "-") === baseName,
  );
  const providerName = provider ? provider.name : baseName;

  // T-013: a generic provider's locators live inside one entry of a shared
  // specs.js file (src/ai/generic/specs.js), not in a standalone module with
  // a real export name — "export a JS object EXACTLY named
  // `GENERIC_SPECS.kimi.locators`" is not legal JS, and "edit this file"
  // pointed at a file holding four OTHER providers' entries too. When the
  // provider entry declares `locatorsShape: "generic-entry"`, ask for just
  // that entry's locators object and say explicitly what must not move.
  const isGenericEntry = provider?.locatorsShape === "generic-entry";

  const exportName =
    provider?.locatorsExport ||
    `${providerName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_LOCATORS`;

  const expectedFilePath =
    provider?.locatorsPath || `src/ai/${baseName}/locators.js`;

  const providerReport = reportData[providerName];
  const reportContext = providerReport
    ? JSON.stringify(providerReport, null, 2)
    : "No specific report data found.";

  const failedAt = providerReport?.failedAt;
  const failedAtLine = failedAt
    ? `The audit aborted at step: "${failedAt}". Focus your selector fixes on the locators used by that step and any steps after it.`
    : "";

  return `I am running a Playwright automation script for ${providerName}, but the DOM selectors/locators are currently failing.

Here is the recent audit report for this provider, including which step failed and a per-step breakdown:
\`\`\`json
${reportContext}
\`\`\`
${failedAtLine ? `\n${failedAtLine}\n` : ""}
Below is the HTML DOM snapshot taken at the exact moment of failure.
Please analyze this HTML and provide the updated CSS/Playwright locators needed to interact with the chat interface. Specifically, I need locators for:
- newChatBtn
- inputBox
- sendBtn
- stopBtn (the button visible while the AI is generating a response)
- responseBlock (the container holding the AI's final response text)
- doneSignal (any element that reliably indicates generation has finished, e.g. copy/like/feedback buttons)

CRITICAL INSTRUCTIONS FOR AI RESPONSE:
${
  isGenericEntry
    ? `1. Output ONLY the updated \`locators\` object for the \`${provider.locatorsEntryId}\` entry — a plain JavaScript object literal, NOT an export statement (\`${exportName}\` is a path into a shared file, not a real export name).
2. At the very top of the JavaScript code block, include a comment: // relative path: ${expectedFilePath} — locators for the "${provider.locatorsEntryId}" entry ONLY
3. Do NOT reproduce the whole file. ${expectedFilePath} holds four OTHER providers' entries plus non-locator fields (id, url, urlMatch, maxPromptChars, attachBtn, rateLimit, dismiss, stripSuffix) on THIS entry — none of that is being asked for and none of it should appear in your reply.
4. Return ONLY the JavaScript object literal enclosed in \`\`\`javascript ... \`\`\`.
5. ABSOLUTELY DO NOT generate any interactive widgets, dashboards, visualizations, or UI components.
6. Keep explanations brief or omit them; the code block is the priority.`
    : `1. Output the updated locators as a JavaScript exported object EXACTLY named \`${exportName}\`.
2. At the very top of the JavaScript code block, include a comment: // relative path: ${expectedFilePath}
3. Return ONLY the JavaScript code block enclosed in \`\`\`javascript ... \`\`\`.
4. ABSOLUTELY DO NOT generate any interactive widgets, dashboards, visualizations, or UI components.
5. Keep explanations brief or omit them; the code block is the priority.`
}

--- DOM SNAPSHOT ---
\`\`\`html
${htmlContent}
\`\`\`
`;
}
