// --- FILE START ---
// Relative Path: src/ai/copilot/client/interaction/prompt/responseValidator/textChecks.js

import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

export function checkTextForErrors(responseText) {
  const lowText = responseText.toLowerCase();

  if (
    responseText.includes("Something went wrong") &&
    responseText.length < 200
  ) {
    log(
      `\n${colors.yellow("⚠️")} Copilot returned "Something went wrong" text. Forcing rotation...`,
    );
    return {
      action: "return",
      result: {
        ok: false,
        needsRotation: true,
        reason: "Copilot returned 'Something went wrong' text.",
      },
    };
  }

  if (
    responseText.includes("OK, I've stopped generating") ||
    responseText.includes("I've stopped generating the response")
  ) {
    log(
      `\n${colors.yellow("⚠️")} Copilot generation was stalled and manually aborted. Forcing rotation...`,
    );
    return {
      action: "return",
      result: {
        ok: false,
        needsRotation: true,
        reason: "Copilot generation stalled and was aborted.",
      },
    };
  }

  const imageMarkers = [
    "here's the image",
    "here's your image",
    "i've generated an image",
    "i generated an image",
    "i've created an image",
    "i created an image",
    "here's the design",
    "i've designed",
    "using microsoft designer",
    "i've used designer",
    "i used designer",
    "here's a visual",
    "i've made an image",
  ];

  if (imageMarkers.some((m) => lowText.includes(m)) && !responseText.includes("```")) {
    log(
      `\n${colors.yellow("⚠️")} Copilot generated an image instead of a text response. Requesting correction...`,
    );
    return {
      action: "return",
      result: {
        ok: false,
        needsCorrection: true,
        reason:
          "The AI generated an image via Microsoft Designer instead of a text/JSON response. Do NOT generate images. Respond with plain text or a JSON array.",
      },
    };
  }

  const widgetMarkers = [
    "here's your new page",
    "i've created a new page",
    "here is the page i created",
    "i've created a page",
    "i created a page",
    "i've made a page",
    "here's the page",
    "here is your page",
    "your page is ready",
    "i've put together a page",
    "i created your page",
    "here's your canvas",
    "i've created a canvas",
    "i created a canvas",
    "here's a loop component",
    "i've added it to pages",
    "i've saved it to pages",
    "i've opened it in pages",
    "added to pages",
    "created in pages",
    "open in pages",
  ];

  if (
    widgetMarkers.some((m) => lowText.includes(m)) &&
    !responseText.includes("```json")
  ) {
    log(
      `\n${colors.yellow("⚠️")} Copilot attempted to send a widget link. Requesting in-chat correction...`,
    );
    return {
      action: "return",
      result: {
        ok: false,
        needsCorrection: true,
        reason:
          "The AI sent a widget/page link instead of a raw JSON response. Please output the response directly in the chat.",
      },
    };
  }

  // Copilot content-filter refusal phrases — checked case-insensitively.
  // Add new variants here as they are observed in the wild.
  const refusalPhrases = [
    "it looks like i can't respond to this",
    "it looks like i can't chat about this",
    "i can't help with that",
    "i'm not able to help with that",
    "i can't assist with that",
    "try a different topic",
    "let's try a different topic",
    "let's talk about something else",
    "i'm not able to discuss that",
    "i'm unable to help with that request",
    "this falls outside what i can help with",
  ];

  if (refusalPhrases.some((p) => responseText.toLowerCase().includes(p))) {
    log(
      `\n${colors.yellow("🚫")} COPILOT TOPIC REFUSAL DETECTED. Rotating into fresh chat...`,
    );
    return {
      action: "return",
      result: {
        ok: false,
        needsRotation: true,
        isRefusal: true,
        reason:
          "The prompt was rejected by the provider's content filter. Retrying without constraint prefix in fresh chat.",
      },
    };
  }

  return null;
}