import { log } from "#app/ui/log.js";
import { colors } from "#app/ui/colors.js";

// Grok 4 (mid-2026) always reasons ("Thought for Xs") regardless of any UI
// toggle — there is no per-prompt reasoning switch at the free tier. The
// thinking block is handled in extract.js (stripped before JSON parsing), so
// it no longer causes INVALID_JSON failures. setGrokMode is kept as a no-op
// rather than removed so the session manager can call it unconditionally.
export async function setGrokMode(_page, _rawModeKey) {
  log(`\n⚙️  Grok 4 always reasons — mode select is a no-op (handled in extractor).`);
}
