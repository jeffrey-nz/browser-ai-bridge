import { extractAndNormalize } from "#utils/responseParser.js";

export async function gatherMetrics(session, responseText) {
  let messageCount = 0;

  if (session.providerId?.includes("copilot")) {
    messageCount = await session.page
      .evaluate(
        () =>
          document.querySelectorAll(
            'div[id^="chatMessageResponse-"], [data-testid="m365-chat-llm-web-ui-chat-message"], [data-content="ai-message"], [data-testid="ai-message"], [data-testid="chat-message-content"], .message-content',
          ).length,
      )
      .catch(() => 0);
  }

  const { data: parsedData, normalizedText } =
    extractAndNormalize(responseText);

  return {
    messageCount,
    data: parsedData,
    normalizedText,
  };
}
