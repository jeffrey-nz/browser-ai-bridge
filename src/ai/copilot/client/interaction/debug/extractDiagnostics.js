export async function extractDiagnostics(page) {
  return await page
    .evaluate(() => {
      const btnInfo = (btn) => {
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return {
          tag: btn.tagName,
          ariaLabel: btn.getAttribute("aria-label") || "",
          title: btn.getAttribute("title") || "",
          dataTestId: btn.getAttribute("data-testid") || "",
          id: btn.id || "",
          disabled: btn.disabled,
          hidden:
            btn.hidden ||
            btn.style.display === "none" ||
            btn.style.visibility === "hidden",
          width: Math.round(r.width),
          height: Math.round(r.height),
          text: btn.innerText?.trim().slice(0, 60) || "",
        };
      };

      const inputEl =
        document.querySelector("#m365-chat-editor-target-element") ||
        document.querySelector('[data-lexical-editor="true"]') ||
        document.querySelector('[data-testid="composer-input"]') ||
        document.querySelector('textarea[placeholder*="Copilot" i]') ||
        document.querySelector("textarea");

      const inputInfo = inputEl
        ? {
            tag: inputEl.tagName,
            placeholder: inputEl.placeholder || "",
            value: (inputEl.value || inputEl.innerText || "").slice(0, 120),
            disabled: inputEl.disabled,
            readOnly: inputEl.readOnly,
            dataTestId: inputEl.getAttribute("data-testid") || "",
            height: Math.round(inputEl.getBoundingClientRect().height),
            id: inputEl.id || "",
          }
        : null;

      const sendBtnContainers = Array.from(
        document.querySelectorAll(
          '[data-testid="composer-content"] div, [data-testid="composer-content"] span',
        ),
      )
        .filter((el) =>
          Array.from(el.classList).some(
            (c) => c === "w-0" || c.startsWith("w-[0"),
          ),
        )
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            classes: Array.from(el.classList).join(" ").slice(0, 80),
            width: Math.round(r.width),
            height: Math.round(r.height),
            childCount: el.childElementCount,
            innerText: el.innerText?.trim().slice(0, 40) || "",
          };
        });

      const stopBtn = document.querySelector(
        'button[aria-label*="Stop"], button[title*="Stop"]',
      );
      const composerArea =
        document.querySelector('[data-testid="composer-content"]') ||
        document.querySelector("#m365-chat-input-shared-container") ||
        document.body ||
        document.documentElement;

      const allBtns = composerArea
        ? Array.from(composerArea.querySelectorAll("button")).map(btnInfo)
        : [];

      const msgCount = document.querySelectorAll(
        'div[id^="chatMessageResponse-"], [data-testid="m365-chat-llm-web-ui-chat-message"], [data-content="ai-message"]',
      ).length;

      const lastAiMsgs = document.querySelectorAll(
        '[data-content="ai-message"]',
      );
      const lastAiText = lastAiMsgs.length
        ? lastAiMsgs[lastAiMsgs.length - 1]?.innerText?.trim().slice(0, 300)
        : "";

      const regenBtn = document.querySelector(
        '[data-testid="regenerate-message-button-popover"], button[aria-label="Regenerate"]',
      );

      return {
        inputInfo,
        stopBtnVisible: !!stopBtn && stopBtn.offsetParent !== null,
        stopBtnAriaLabel: stopBtn?.getAttribute("aria-label") || "",
        allComposerButtons: allBtns,
        messageCount: msgCount,
        lastAiText,
        regenerateBtnPresent: !!regenBtn,
        sendBtnContainers,
      };
    })
    .catch((e) => ({ error: e.message }));
}
