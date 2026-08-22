#!/usr/bin/env node
// serverProvenance.mjs — T-083. CLAUSE 0 ("the live run comes from a
// bridge started after the commit under test, quote serverProvenance/
// loadedCommit/treeDirty") is on almost every live-verification ticket
// this board files, and until now it was enforced by retyping it into
// each ticket's acceptance and by nothing else — two evidence scripts
// written hours apart (evidence/t079-askall-deepseek.mjs,
// evidence/t075-repro.mjs) disagreed about which fields it names, because
// each re-implemented the convention from memory. This is the ONE place
// that reads /api/ping and decides what CLAUSE 0's provenance block
// contains, so a future evidence script imports it instead of retyping
// the fetch.
//
// extractServerProvenance() is the pure half (testable without a
// network): given an already-parsed ping response (or null/undefined, if
// the fetch itself never got a response), it returns loadedCommit and
// loadedTreeDirty read from the response — never defaulted to false or
// silently omitted — PLUS a `fieldsPresent` map so a caller (or a test)
// can tell "the server responded but the field was not in the JSON"
// apart from "the value happened to be null/false". fetchServerProvenance()
// is the thin wrapper that does the actual fetch and adds `reachable`,
// distinguishing "we asked and got a response" from "we never got an
// answer at all" — the same distinction `fieldsPresent` draws one level
// down, for the two different ways a field can end up missing.
//
// Usage as a library: import { fetchServerProvenance } from
// "../scripts/serverProvenance.mjs" in an evidence/*.mjs script.

export function extractServerProvenance(pingJson) {
  const hasLoadedCommit = pingJson != null && "loadedCommit" in pingJson;
  const hasLoadedTreeDirty = pingJson != null && "loadedTreeDirty" in pingJson;
  return {
    loadedCommit:
      hasLoadedCommit && typeof pingJson.loadedCommit === "string"
        ? pingJson.loadedCommit
        : null,
    loadedTreeDirty:
      hasLoadedTreeDirty && typeof pingJson.loadedTreeDirty === "boolean"
        ? pingJson.loadedTreeDirty
        : null,
    fieldsPresent: {
      loadedCommit: hasLoadedCommit,
      loadedTreeDirty: hasLoadedTreeDirty,
    },
  };
}

export async function fetchServerProvenance(baseUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const res = await fetch(`${baseUrl}/api/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json();
    return { reachable: true, ...extractServerProvenance(json) };
  } catch {
    // "we didn't ask" (or asked and got no answer) — reachable:false is
    // what tells this apart from "asked, got a response, field missing".
    return { reachable: false, ...extractServerProvenance(null) };
  }
}
