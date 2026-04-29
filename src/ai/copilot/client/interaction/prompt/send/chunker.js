export function chunkText(text, maxLen) {
  const source = typeof text === "string" ? text : String(text ?? "");
  const n = typeof maxLen === "number" ? maxLen : Number(maxLen);
  let safeMaxLen = Number.isFinite(n) ? Math.floor(n) : 0;

  if (!Number.isFinite(safeMaxLen) || safeMaxLen <= 0) {
    safeMaxLen = 2000;
  }
  safeMaxLen = Math.max(1, safeMaxLen);

  const lines = source.split("\n");
  const chunks = [];
  let currentChunk = "";

  for (const line of lines) {
    if (
      currentChunk.length + line.length + 1 > safeMaxLen &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    if (line.length > safeMaxLen) {
      let remaining = line;
      while (remaining.length > 0) {
        const sliceLen = Math.min(remaining.length, safeMaxLen);
        chunks.push(remaining.slice(0, sliceLen));
        remaining = remaining.slice(sliceLen);
      }
    } else {
      currentChunk += (currentChunk ? "\n" : "") + line;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

export function prepareChunkPayload(chunkTextContent, index, totalChunks) {
  const isLast = index === totalChunks - 1;
  const partNum = index + 1;

  if (totalChunks === 1) {
    return chunkTextContent;
  }

  if (index === 0) {
    return (
      `[CONTEXT INGESTION - START ${partNum}/${totalChunks}]\n\n` +
      `I am uploading code for analysis. DO NOT analyze yet.\n` +
      `Respond ONLY with: "PART ${partNum} RECEIVED"\n\n` +
      `--- DATA ---\n${chunkTextContent}`
    );
  }

  if (!isLast) {
    return (
      `[CONTEXT INGESTION - CONTINUE ${partNum}/${totalChunks}]\n\n` +
      `${chunkTextContent}\n\n` +
      `Respond ONLY with: "PART ${partNum} RECEIVED"`
    );
  } else {
    return (
      `[CONTEXT INGESTION - FINAL ${partNum}/${totalChunks}]\n\n` +
      `${chunkTextContent}\n\n` +
      `[INGESTION COMPLETE] You now have the full codebase.\n` +
      `Respond ONLY with: "PART ${partNum} RECEIVED". I will now send the specific task instructions.`
    );
  }
}
