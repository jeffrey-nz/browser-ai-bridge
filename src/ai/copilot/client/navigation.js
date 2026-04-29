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

export function findCopilotPage(pages) {
  const candidates = pages.filter((p) => {
    try {
      return isCopilotUrl(p.url());
    } catch {
      return false;
    }
  });

  return candidates[candidates.length - 1] || null;
}

export function findCopilot365Page(pages) {
  const candidates = pages.filter((p) => {
    try {
      return isCopilot365Url(p.url());
    } catch {
      return false;
    }
  });

  return candidates[candidates.length - 1] || null;
}
