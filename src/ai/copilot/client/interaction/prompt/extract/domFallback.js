export async function extractBlockViaDOM(block) {
  let text = await block.innerText({ timeout: 2000 }).catch(() => "");

  const noiseRegexes = [
    /^Download\s*\n/i,
    /^(javascript|typescript|html|css|php|json|bash|sh|xml|plain text|markdown)\s*\n/im,
    /^Copy( code)?\s*\n/im,
    /Show more lines\s*\n?/gi,
    /Show less\s*\n?/gi,
    /^import fs from ["']fs["'];?\s*\n/im,
    /fs\.writeFileSync\([\s\S]*?String\.raw\s*`/i,
    /`\s*\);?$/m,
  ];

  for (const regex of noiseRegexes) {
    text = text.replace(regex, "");
  }

  text = text.replace(/\xA0/g, " ");

  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return `\`\`\`json\n${trimmed}\n\`\`\``;
  }

  return trimmed;
}

export async function extractConversationalFallback(lastMessage) {
  let text = await lastMessage.innerText({ timeout: 2000 }).catch(() => "");

  const noiseRegexes = [
    /^Download\s*\n/i,
    /Copy( code)?\s*\n/gi,
    /Show more lines\s*\n?/gi,
    /Show less\s*\n?/gi,
  ];

  for (const regex of noiseRegexes) {
    text = text.replace(regex, "");
  }

  text = text.replace(/\xA0/g, " ");

  return text.trim();
}
