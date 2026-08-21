import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";
import { logger } from "#utils/logger.js";
import { pollUntil } from "#utils/poller.js";
import { eventBus } from "#web/eventBus.js";
import {
  clearAndType,
  clickOrFallbackToEnter,
  extractText,
} from "#ai/shared/domInteraction.js";
import { uploadFileToPage } from "#ai/shared/uploadFile.js";
import { cleanAiResponse } from "#ai/shared/markdownCleaner.js";
import { runPromptWorkflow } from "#ai/shared/promptWorkflow.js";
import { DEFAULT_STABLE_POLLS } from "./specs.js";

/**
 * One interaction implementation, driven by a spec. See specs.js for why.
 *
 * COMPLETION IS DETECTED BY THE ANSWER GOING QUIET, not by a done-signal
 * selector, and that is deliberate. Every site here streams its reply, and a
 * "Copy" button appearing is a per-site detail that changes without notice —
 * whereas "the text stopped growing" is true of all of them and cannot be
 * restyled away. It costs one extra poll interval per turn and buys a provider
 * that keeps working through a redesign.
 */

export function makeInteraction(spec) {
  const L = spec.locators;

  const input = (page) => page.locator(L.inputBox).first();

  async function dismissModals(page) {
    for (const label of spec.dismiss ?? []) {
      const b = page.getByRole("button", { name: label, exact: false }).first();
      if (await b.isVisible({ timeout: 600 }).catch(() => false)) {
        await b.click({ force: true }).catch(() => {});
        logger.info(`[${spec.name}] dismissed "${label}"`);
      }
    }
  }

  async function startNewChat(page) {
    log(`\n🔄 Starting a new ${spec.name} chat context...`);
    await dismissModals(page);

    const btn = page.locator(L.newChatBtn).first();
    const clicked = await btn
      .click({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);

    if (!clicked) {
      await page
        .goto(spec.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch((e) => logger.warn(`[${spec.name}] navigate: ${e.message}`));
    }

    await input(page)
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {
        logger.warn(
          `[${spec.name}] composer did not appear — is it signed in?`,
        );
      });
    await page.waitForTimeout(600);
    log(`  ${colors.green("✔")} Clean context established.`);
  }

  async function injectText(page, text) {
    await dismissModals(page);
    await clearAndType(page, input(page), text, {
      chunkSize: 4000,
      triggerEvents: true,
    });
  }

  async function clickSend(page) {
    await clickOrFallbackToEnter(
      page,
      page.locator(L.sendBtn).last(),
      input(page),
      page.locator(L.stopBtn).last(),
      { retries: 4, spaceHack: true, ctrlEnterFallback: true },
    );
  }

  /** Longest visible answer block — sites disagree on which one is "last". */
  async function readAnswer(page) {
    return await page
      .locator(L.responseBlock)
      .last()
      .innerText()
      .catch(() => "");
  }

  //[[ Chrome-only text must count as NO answer during the stability check
  //   (T-005). Mistral's message group renders its turn timestamp and
  //   "Was this helpful?" row before or independently of the model's own
  //   text, so raw innerText can be non-empty and constant — "ready 2:24am"
  //   — for several polls before any real content exists. Judging stability
  //   on the RAW text let that satisfy "stable, non-empty" and declare the
  //   turn done; extractResponse's stripSuffix then emptied it, and its own
  //   never-empty guard (below) restored the raw chrome, which is how a bare
  //   timestamp like "3:59pm" reached a caller as the "answer". Stripping
  //   the SAME declared chrome before measuring length — with no fallback
  //   here, unlike extractResponse — makes chrome-only content read as
  //   length 0, so the poll correctly keeps waiting for the model's actual
  //   text instead of stabilizing on what rendered first. ]]
  function stripChrome(text) {
    let out = String(text || "");
    if (spec.stripPrefix) out = out.replace(spec.stripPrefix, "");
    if (spec.stripSuffix) out = out.replace(spec.stripSuffix, "");
    return out;
  }

  async function waitForCompletion(page) {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };
    eventBus.once("abort_requested", onAbort);

    try {
      await page.waitForTimeout(1200);
      let lastLen = -1;
      let stable = 0;

      return await pollUntil(
        async () => {
          if (aborted) throw new Error("Aborted (Web UI)");

          //[[ A capacity refusal is not a slow answer, and waiting it out is the
          //   wrong move: the tier chain can ask somebody else immediately. Kimi
          //   withdraws an already-rendered reply and restores the prompt when it
          //   is over capacity, so without this the poll would sit watching an
          //   empty composer until it timed out. ]]
          if (spec.rateLimit) {
            const hit = await page
              .getByText(spec.rateLimit, { exact: false })
              .first()
              .isVisible({ timeout: 200 })
              .catch(() => false);
            if (hit) {
              const err = new Error(`${spec.name} is over capacity`);
              err.rateLimited = true;
              throw err;
            }
          }

          const txt = await readAnswer(page);
          const len = stripChrome(txt).trim().length;

          if (len > 0 && len === lastLen) {
            stable += 1;
            if (stable >= DEFAULT_STABLE_POLLS) return true;
          } else {
            stable = 0;
          }
          lastLen = len;
          return false;
        },
        { timeoutMs: 300000, intervalMs: 1500 },
      );
    } finally {
      eventBus.off?.("abort_requested", onAbort);
    }
  }

  async function extractResponse(page) {
    const block = page.locator(L.responseBlock).last();
    let text = await extractText(page, block).catch(() => "");
    if (!text || !text.trim()) text = await readAnswer(page);
    //[[ A site-specific header that is not part of the answer. GLM renders its
    //   collapsed reasoning block as the literal words "Thought Process", so
    //   without this every reply arrives as "Thought Process <answer>" and a
    //   caller parsing a one-word reply gets two. Declared per spec rather than
    //   pattern-matched globally: stripping a phrase that a DIFFERENT model
    //   legitimately wrote would be silent corruption of an answer. ]]
    //[[ A CLEANER MUST NEVER EMPTY AN ANSWER. Both strips below are applied only
    //   if something survives them: the mistral suffix rule deleted an entire
    //   reply the first time it ran, and the bridge reported EMPTY_RESPONSE for a
    //   turn the model had answered correctly. Losing the chrome is worth a
    //   little; losing the answer is not, and a rule that can do the second is
    //   not worth the first. ]]
    const trim = (t, re) => {
      if (!re) return t;
      const out = String(t || "").replace(re, "");
      return out.trim() ? out : t;
    };

    text = trim(text, spec.stripPrefix);
    //[[ And the chrome AFTER the answer. Mistral's message group includes the
    //   turn's timestamp and its "Was this helpful?" feedback row, so a one-word
    //   reply arrived as "ready 2:24am Was this helpful? Skip". Narrowing the
    //   response selector further would tie this to Tailwind classes that change
    //   with every redesign; trimming a declared, site-specific tail does not. ]]
    text = trim(text, spec.stripSuffix);
    return cleanAiResponse(text || "");
  }

  async function sendPromptAndWait(page, text, label = "Prompt") {
    return runPromptWorkflow(page, text, label, {
      providerName: spec.name,
      injectText,
      clickSend,
      waitForCompletion,
      extractResponse,
    });
  }

  async function sendPromptWithFile(page, filePath, text, label = "Visual QA") {
    logger.info(`[${spec.name}] Uploading ${filePath}`);
    let imageAttached = false;
    try {
      imageAttached = await uploadFileToPage(page, filePath, {
        attachmentBtnSelector: spec.attachBtn,
        verifySelector: spec.attachEvidence,
        secondClickSelector: spec.attachMenuItem,
        requireGrowth: spec.requireGrowth,
      });
    } catch (err) {
      logger.warn(
        `[${spec.name}] File upload failed: ${err.message} — sending text-only`,
      );
    }
    if (!imageAttached) {
      logger.warn(
        `[${spec.name}] Upload could not be confirmed — sending text-only, caller should not trust a visual answer.`,
      );
    }
    const result = await sendPromptAndWait(page, text, label);
    return { ...result, imageAttached };
  }

  return {
    startNewChat,
    injectText,
    clickSend,
    sendPromptAndWait,
    sendPromptWithFile,
  };
}
