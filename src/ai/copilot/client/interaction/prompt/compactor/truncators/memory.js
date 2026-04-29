export function truncateMemory(text) {
  const memoryMarker = "## 🧠 MEMORY";
  const memStart = text.indexOf(memoryMarker);

  if (memStart !== -1) {
    const memEnd = text.indexOf("\n## ", memStart + memoryMarker.length);
    if (memEnd !== -1) {
      return (
        text.slice(0, memStart) +
        memoryMarker +
        "\n```markdown\n[MEMORY TRUNCATED TO FIT CHAR LIMIT]\n```\n" +
        text.slice(memEnd)
      );
    }
  }
  return text;
}
