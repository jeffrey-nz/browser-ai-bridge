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
import { classifyUploadError } from "#ai/shared/uploadOutcome.js";
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

  //[[ A CAPACITY MODAL LOOKS EXACTLY LIKE A BROKEN SEND BUTTON.
  //   The only capacity gate used to be inside waitForCompletion, which is
  //   reached only once a prompt is away. When the notice arrives as a modal it
  //   covers the composer instead, so the send never lands: clickOrFallbackToEnter
  //   burned its four retries, threw a generic "failed to trigger send", and the
  //   turn died with nothing saying why — the provider was never marked
  //   rate-limited, so the tier chain could not route around it and the same tab
  //   met the same modal on the next attempt.
  //   Now a send failure asks the page whether it is a capacity refusal before
  //   giving up. If it is, the error is tagged `rateLimited` (promptWorkflow's
  //   outer catch turns that into a clean hand-off) and the modal is dismissed
  //   so the tab is usable again rather than left poisoned for the next turn. ]]
  async function clickSend(page) {
    try {
      await clickOrFallbackToEnter(
        page,
        page.locator(L.sendBtn).last(),
        input(page),
        page.locator(L.stopBtn).last(),
        { retries: 4, spaceHack: true, ctrlEnterFallback: true },
      );
    } catch (err) {
      if (await checkRateLimitHit(page)) {
        await dismissModals(page).catch(() => {});
        const e = new Error(`${spec.name} is over capacity (send blocked)`);
        e.rateLimited = true;
        throw e;
      }
      throw err;
    }
  }

  //[[ THE LAST *OUTERMOST* MATCH, NOT THE LAST MATCH IN DOCUMENT ORDER.
  //
  //   `.last()` reads whichever matching element comes last in the DOM, and on a
  //   nested match that is the DEEPEST one, not the answer. Measured live on
  //   chat.qwen.ai (2026-09-24): a single assistant turn matched 13 elements,
  //   because qwen's answer container, its markdown wrapper, its code block, that
  //   block's header, body and viewport ALL carry a class containing "markdown"
  //   or "message"+"content". The last of the 13 was
  //   `qwen-markdown-code-horizontal-scroll-proxy-content` — an empty scroll
  //   shim. So readAnswer returned "".
  //
  //   That empty string is not a cosmetic bug. waitForCompletion stabilises on
  //   `len > 0 && len === lastLen`, so a permanent 0 never satisfies it: the poll
  //   ran the full 300000ms and the turn died as a timeout, on a page where the
  //   model had answered correctly a minute earlier. It looked like a slow
  //   provider and it was an unreadable selector — the same confusion T-005 hit
  //   from the other side, where the selector matched the wrong element rather
  //   than nothing.
  //
  //   Taking the LONGEST match, which this function's old one-line description
  //   claimed it did, is the wrong repair: an earlier turn in the same session
  //   can legitimately be longer than the current one, and answering with it
  //   would be silent corruption rather than a visible timeout. Outermost keeps
  //   BOTH properties — it is the current turn (last), and it is the whole
  //   answer container rather than a fragment of it (outermost). For a spec whose
  //   matches never nest, every match is outermost and this is exactly `.last()`.
  //
  //   Note what this does NOT fix: qwen renders long code blocks in a VIRTUALISED
  //   Monaco viewport that mounts only the visible rows, so the container's
  //   innerText is genuinely partial for a long answer and no selector can reach
  //   the rest. `detectTruncation` below is what refuses those. ]]
  async function readAnswer(page) {
    const texts = await page
      .locator(L.responseBlock)
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => !nodes.some((other) => other !== n && other.contains(n)))
          .map((n) => n.innerText || ""),
      )
      .catch(() => []);
    if (texts.length) return texts[texts.length - 1];
    // evaluateAll is unavailable on some fakes and on a page that navigated
    // mid-poll; the original single-element read is a safe fallback.
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

  //[[ T-114: extracted from the poll loop below, unchanged, so it can be
  //   tested without driving the whole sendPromptAndWait pipeline — same
  //   convention src/routes/ask/tiers.js's skipTier() and anyRateLimited()
  //   already use ("extracted from the route's loop so it can be tested").
  //   `if (spec.rateLimit)` is the ONLY thing in src/ai/generic/ that
  //   distinguishes kimi (a real phrase) from the other four (null) — API.md
  //   crediting all five with "their own detected throttle" was the wrong
  //   sentence this exists to pin against. ]]
  //[[ `rateLimit` may be one phrase or several. It began as a single string and
  //   stays valid as one; an array is checked phrase by phrase and hits on the
  //   first match. See the kimi entry in specs.js for why a list exists. ]]
  async function checkRateLimitHit(page) {
    if (!spec.rateLimit) return false;
    const phrases = Array.isArray(spec.rateLimit)
      ? spec.rateLimit
      : [spec.rateLimit];
    for (const phrase of phrases) {
      const seen = await page
        .getByText(phrase, { exact: false })
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (seen) {
        logger.warn(`[${spec.name}] capacity notice on page: "${phrase}"`);
        return true;
      }
    }
    return false;
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
          const hit = await checkRateLimitHit(page);
          if (hit) {
            const err = new Error(`${spec.name} is over capacity`);
            err.rateLimited = true;
            throw err;
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
    let imageAttachedCause;
    // T-053: see uploadFile.js's evidenceOut comment — a `true` gets a
    // cause the same way T-038 gave `false` one.
    const evidenceOut = {};
    try {
      imageAttached = await uploadFileToPage(page, filePath, {
        attachmentBtnSelector: spec.attachBtn,
        verifySelector: spec.attachEvidence,
        secondClickSelector: spec.attachMenuItem,
        requireGrowth: spec.requireGrowth,
        // T-035: left undefined for every provider but kimi, so
        // uploadFileToPage's own 6000ms default applies unchanged there.
        ...(spec.verifyTimeoutMs != null
          ? { verifyTimeoutMs: spec.verifyTimeoutMs }
          : {}),
        evidenceOut,
      });
    } catch (err) {
      imageAttachedCause = classifyUploadError(err);
      logger.warn(
        `[${spec.name}] File upload failed (${imageAttachedCause}): ${err.message} — sending text-only`,
      );
    }
    if (!imageAttached) {
      logger.warn(
        `[${spec.name}] Upload could not be confirmed — sending text-only, caller should not trust a visual answer.`,
      );
    }
    const result = await sendPromptAndWait(page, text, label);
    return {
      ...result,
      imageAttached,
      // T-053 review: evidenceOut carries `evidenceSelectorUsed`
      // unconditionally (set before uploadFileToPage can throw) — a false
      // row needs to prove what selector was actually running just as much
      // as a true row needs to explain what matched, so it is no longer
      // gated behind `imageAttached`.
      ...(imageAttached ? {} : { imageAttachedCause }),
      imageAttachedEvidence: evidenceOut,
    };
  }

  return {
    startNewChat,
    injectText,
    clickSend,
    sendPromptAndWait,
    sendPromptWithFile,
    checkRateLimitHit,
    // Exported for tests the same way checkRateLimitHit is (T-114): which
    // element readAnswer picks decides whether a turn completes at all, and
    // that was unpinned while `.last()` silently read an empty scroll shim.
    readAnswer,
  };
}
