export async function waitForComposerReady(page) {
  const textArea = page
    .locator(
      [
        "#m365-chat-editor-target-element",
        '[data-lexical-editor="true"]',
        '[data-testid="composer-input"]',
        "#userInput",
        "textarea",
        '[contenteditable="true"]',
        "#searchbox",
        '[role="textbox"]',
      ].join(", "),
    )
    .filter({ visible: true })
    .last();

  await textArea.waitFor({ state: "visible", timeout: 12000 });
  await textArea.scrollIntoViewIfNeeded().catch(() => {});
  await textArea.click().catch(() => {});
  await textArea.focus().catch(() => {});

  let disabled = await textArea.isDisabled().catch(() => false);
  let attempts = 0;
  while (disabled && attempts < 16) {
    await page.waitForTimeout(500);
    disabled = await textArea.isDisabled().catch(() => false);
    attempts++;
  }

  if (disabled) {
    throw new Error("Text area stayed disabled after waiting.");
  }

  return textArea;
}
