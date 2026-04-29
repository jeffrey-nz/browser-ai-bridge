export async function getPromptChoice(
  rl,
  promptChoiceFn,
  includeKeepWaiting,
  timeoutMs,
) {
  const options = [
    { label: "Retry injection (same page)", value: "retry_same" },
    { label: "Refresh page and retry (fixes stuck UI)", value: "refresh" },
    ...(includeKeepWaiting
      ? [{ label: "Keep waiting (resume polling)", value: "keep_waiting" }]
      : []),
    { label: "Skip this turn (return empty to AI)", value: "skip" },
    { label: "Provide manual AI response (paste XML)", value: "manual" },
  ];

  const promptOpts = {
    defaultOption: 1,
    allowCustom: false,

    ...(timeoutMs ? { timeoutMs, timeoutValue: "refresh" } : {}),
  };

  return await promptChoiceFn(rl, "Action required:", options, promptOpts);
}
