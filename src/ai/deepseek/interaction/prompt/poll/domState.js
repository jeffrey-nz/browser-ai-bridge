export async function getDeepSeekDomState(
  page,
  cfOverlaySel,
  stopBtnSel,
  responseBlockSel,
) {
  const [isBlocked, isGenerating, currentCount] = await Promise.all([
    page
      .locator(cfOverlaySel)
      .isVisible({ timeout: 200 })
      .catch(() => false),
    page
      .locator(stopBtnSel)
      .last()
      .isVisible({ timeout: 200 })
      .catch(() => false),
    page
      .locator(responseBlockSel)
      .count()
      .catch(() => 0),
  ]);

  let currentText = "";

  if (currentCount > 0) {
    currentText = await page
      .locator(responseBlockSel)
      .last()
      .innerText({ timeout: 300 })
      .catch(() => "");
  }

  return { isBlocked, isGenerating, currentCount, currentText };
}
