export function isCopilotUrl(url) {
  const u = (url || "").toLowerCase();

  return u.includes("copilot.microsoft.com") || u.includes("bing.com/chat");
}

export function isCopilot365Url(url) {
  const u = (url || "").toLowerCase();

  return (
    u.includes("m365.cloud.microsoft") ||
    (u.includes("cloud.microsoft") && u.includes("copilot"))
  );
}
