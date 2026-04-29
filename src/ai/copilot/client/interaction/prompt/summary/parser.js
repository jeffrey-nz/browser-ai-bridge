export function extractSummary(text) {
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(text);
  return summaryMatch ? summaryMatch[1].trim() : null;
}

export function isPureToolCalls(text) {
  const textWithoutCodeBlocks = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<summary>[\s\S]*?<\/summary>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, "")
    .replace(/<phase>[\s\S]*?<\/phase>/gi, "")
    .replace(/<plan>[\s\S]*?<\/plan>/gi, "")
    .replace(/<step_done>[\s\S]*?<\/step_done>/gi, "")
    .replace(/<note>[\s\S]*?<\/note>/gi, "")
    .replace(/<decision>[\s\S]*?<\/decision>/gi, "")
    .replace(/<blocker>[\s\S]*?<\/blocker>/gi, "")
    .replace(/<wishlist>[\s\S]*?<\/wishlist>/gi, "")
    .trim();
  return textWithoutCodeBlocks.length < 30;
}

export function extractTagsText(text) {
  const tagsOnly = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<summary>[\s\S]*?<\/summary>/gi, "")
    .replace(/<patch([^>]*)>[\s\S]*?<\/patch>/gi, "<patch$1>[code]</patch>")
    .replace(/<file([^>]*)>[\s\S]*?<\/file>/gi, "<file$1>[code]</file>")
    .replace(
      /<analysis>([\s\S]*?)<\/analysis>/gi,
      (_, c) => `<analysis>${c.trim().replace(/\n/g, " ")}</analysis>`,
    )
    .replace(
      /<reflection>([\s\S]*?)<\/reflection>/gi,
      (_, c) => `<reflection>${c.trim().replace(/\n/g, " ")}</reflection>`,
    )
    .replace(
      /<plan>([\s\S]*?)<\/plan>/gi,
      (_, c) => `<plan>${c.trim().split("\n").slice(0, 6).join(" | ")}</plan>`,
    )
    .trim();

  const xmlTagPattern =
    /<(phase|plan|step_done|note|decision|blocker|wishlist|summary|analysis|reflection)[^>]*>/i;

  if (xmlTagPattern.test(tagsOnly)) {
    const lines = tagsOnly.split("\n").filter(Boolean);
    return lines.filter((line) =>
      /<(phase|plan|step_done|note|memo|decision|blocker|wishlist|analysis|reflection)[^>]*>/i.test(
        line,
      ),
    );
  }
  return [];
}
