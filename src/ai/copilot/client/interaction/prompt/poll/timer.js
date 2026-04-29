export function createPollState(timeoutMs = 300000) {
  const start = Date.now();
  return {
    start,
    timeoutMs,
    lastStatus: "",
    lastEmittedLength: 0,
    lastTextLength: 0,
    lastChangeTime: Date.now(),
    notGeneratingStreak: 0,
    NOT_GENERATING_REQUIRED: 2,
    isExpired() {
      return Date.now() - this.start > this.timeoutMs;
    },
  };
}
