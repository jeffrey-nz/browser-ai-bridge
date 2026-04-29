export function handleChunkFailure(recovery) {
  if (recovery.action === "return") {
    return { action: "return", result: recovery.result, retry: false };
  }

  if (
    recovery.action === "retry" ||
    recovery.action === "retry_same" ||
    recovery.action === "keep_waiting"
  ) {
    return { retry: true };
  }

  return { retry: false };
}
