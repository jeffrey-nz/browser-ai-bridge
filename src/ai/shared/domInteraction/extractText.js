export async function extractText(
  page,
  primaryLocator,
  fallbackLocator = null,
  replacements = [],
) {
  let text = "";
  try {
    await primaryLocator
      .waitFor({ state: "attached", timeout: 5000 })
      .catch(() => {});
    text = await primaryLocator.innerText().catch(() => "");
  } catch (e) {}

  if (!text && fallbackLocator) {
    text = await fallbackLocator.innerText().catch(() => "");
  }

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.trim();
}
