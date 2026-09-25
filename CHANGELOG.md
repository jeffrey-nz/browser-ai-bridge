# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-09-25

Everything since 1.0.0: five new providers, `/api/ask-all`, provider tiers,
image attachments, a tab janitor, per-lane cooldowns, and a docs and code tidy-up.

### Breaking changes

- `copilot365` is no longer a provider id; requests naming it get
  `400 Unknown provider specified`.
- `/api/ask` responses drop `messageCount` (it was only ever computed for
  Copilot) and add `turnIndex` and `sessionAgeMs` instead.
- Copilot's prompt limit is 9,500 characters (was 32,000); longer prompts get
  `413`.
- Per-IP rate limiting on `/api/` is gone. The server still binds to
  `127.0.0.1` only.
- Gemini defaults to Flash, not Pro, when no `mode` is given.

### Added

- **Five more providers** — `kimi`, `qwen`, `zai`, `mistral`, `perplexity` — as
  one spec-driven implementation (`src/ai/generic/specs.js`).
- **`POST /api/ask-all`**: one prompt to several providers in parallel, every
  answer returned side by side.
- **Provider tiers**: `providers` / `fallback` on `/api/ask`, or
  `PROVIDER_TIERS` in `.env`, fall through to the next provider on a rate limit
  or cooldown. The reply's `provider` says who answered.
- **Images on `/api/ask`** (`images`), with `imageAttached` and
  `imageAttachedCause` reporting whether the provider actually got the file.
- **Endpoints:** `/api/setup`, `/api/tabs` and `/api/tabs/sweep`,
  `/api/devserver`, `/api/visual-ask`, `/api/image-ask`, `/api/audio-ask`,
  `/api/page-inspect`, `/api/evaluate`, `/api/click`, `/api/wait-for`,
  `/api/ping/warmup`, and, per session, `/evaluate`, `/new-chat` and
  `/extract-image`. The screenshot API gains `/session/:id`, `/sessions`,
  `/monitor` and `/baseline/:id`.
- **npm package:** a `browser-ai-bridge` CLI and a Node client
  (`browser-ai-bridge/client`).
- **`/api/ping`** now returns `503` until setup finishes, and adds
  `loadedCommit`, memory figures, per-provider counts and cooldowns,
  `longRunningSessions`, `attachedPages` and `lastUnexpectedPageCloseAt`.
- **Tab janitor:** caps tabs at `MAX_TABS_PER_PROVIDER` and closes abandoned
  turns, orphan tabs and idle standby tabs. The per-provider session cap is
  enforced atomically.
- **Rate limits and blocked accounts:** cooldowns are kept per lane
  (`provider:mode`) and last as long as the provider says. Usage-limit
  detection covers every provider except Copilot. Suspended and signed-out
  accounts are recognised and skipped.
- `clientTimeoutMs` on `/api/ask` frees the tab once the caller has stopped
  waiting.
- `HEADLESS=offscreen`, `BROWSER_AI_PROVIDERS`, `BROWSER_AI_ASSUME_LOGGED_IN`
  and a "Skip setup" choice. The Chrome profile now persists in
  `~/.browser-ai-bridge/`.
- `npm run audit` covers the generic providers.

### Changed

- Housekeeping: prettier applied to the 26 files CI's format check was failing
  on; unused `express-rate-limit` and `fast-glob` dependencies dropped; the
  reachability gate now treats `npm run` targets under `src/` as entry points
  (so `src/audit/` is no longer allowlisted as "unwired"); spent `tNNN-*.mjs`
  ticket probes moved from `scripts/` to `evidence/`; `scripts/doc-check.mjs`
  made green and added to CI as `npm run check:docs`; README/CLAUDE.md layout
  sections brought in line with `src/`.
- Removed the 7 modules and 7 exports nothing imported; the reachability
  allowlist is now empty. `stopTabJanitor()` now runs at the start of shutdown
  so a sweep cannot race `closeAllSessions()`.
- `BROWSER_AI_PROVIDERS` is parsed by one helper, `parseEnabledProviders()`.
- `.env.example` lists every tunable the code reads, commented out at its
  default.
- Stopping the tab janitor now also blocks `POST /api/tabs/sweep` and waits (up
  to 5s) for a sweep already running. Lockfile bumped by `npm audit fix`.
- Docs: API.md rewritten as a reference (1149 → ~680 lines), corrected against
  the code in 24 places, with a table for the 25 endpoints it never listed; README, CONTRIBUTING and CLAUDE.md fixed where
  they had drifted (provider list, response shapes, Chrome profile path, how to
  add a provider, `audit:fix` behaviour).

### Removed

- Self-healing locators (`src/heal/localHealer.js`). `src/heal/` now only
  captures page context for stall diagnostics. (`POST /api/heal` was documented
  but never registered as a route.)

### Fixed

- A **suspended** provider is now put on cooldown for exactly as long as its own
  notice says, instead of being retried every turn. Measured on
  chat.deepseek.com, 2026-09-22: the page carried no composer, no password field
  and no sign-in control — only "Due to violation of user policies, your account
  has been suspended until October 1, 2026 09:21." and a Contact us link. That is
  neither a rate limit (which clears itself) nor a sign-in wall (which a human
  fixes), and the bridge saw only `locator.waitFor: Timeout`, so it took the
  "recoverable" path and reloaded — 5 attempts × (15s + 120s backoff) ≈ eleven
  minutes per turn, rediscovering a nine-day block every turn.
  `diagnoseBlockedPage()` now tells the three causes apart, parses the stated end
  time, and calls `cooldownManager.trigger()` with the real remaining seconds, so
  the tier chain skips that provider until it actually expires. An unparseable or
  absent end time falls back to one hour rather than being honoured blindly, and
  a date beyond a month is treated as a misparse. As the `WRITABLE_PROVIDERS`
  note requires, that set is expanded in the same change — the writer lives in
  the shared send path, so every configured provider now has one; the tri-state
  contract (no writer reads `null`, never `false`) is unchanged and still tested.
- A signed-out provider is now detected and skipped instead of being reloaded
  and retried. Login is verified once, at startup, and never again, so a session
  that drops mid-run was invisible: the composer never renders, the input locator
  times out, and the error lands in `_injectAndSendWithRecovery`'s "recoverable"
  branch — which reloads the page and retries, the one remedy guaranteed not to
  work on a sign-in wall. Measured 2026-09-22 on a long generation run: DeepSeek
  signed itself out and the turn spent 5 attempts × (15s locator timeout + 120s
  backoff), about **eleven minutes**, before the chain moved on — then met the
  same wall on the next turn. `looksSignedOut()` now checks for this before the
  reload and throws a tagged error, so the executor skips that provider at once
  and the log says plainly that a human needs to log in. Detection requires BOTH
  a visible sign-in control AND the absence of any composer, because a false
  positive would discard a working provider — a signed-in page that merely shows
  a "Sign in" link still has a composer and does not match.
- A single busy tab no longer kills the whole browser. `getBrowserContext`'s
  health check raced its timeout against `pages[0].evaluate(() => 1)` as well as
  `browser.version()`. `pages[0]` is whichever page happens to be first — often a
  provider tab streaming a long answer — and a page whose JS thread is busy does
  not answer `evaluate` until it is free, so the race timed out on a perfectly
  healthy browser and took the hard-reset path: Chrome killed, every other
  in-flight session destroyed with it. Measured on 2026-09-22: **six hard resets
  in one bridge session** during a long generation run, each losing the turn in
  flight. `browser.version()` is answered by the CDP endpoint and does not depend
  on any page, so it alone now decides whether to reset; the page probe is kept
  on its own 2s budget and reported as a stuck _page_, never as a dead browser.
- Kimi capacity modal no longer hangs a turn. Two independent gaps, both behind
  the same symptom — a run sitting on Kimi's "too many requests" notice instead
  of moving to the next provider:
  - `GENERIC_SPECS.kimi.rateLimit` held **one** sentence, the wording kimi.ai
    used in 2026-08. Any rewording silently disabled the per-provider gate, so
    the turn ran out the full 300s completion poll and fell into manual
    recovery. The field now accepts a list (a single string still works) and
    covers the other halves of the same notice. Phrases a model could plausibly
    write in a good answer — "rate limit", "try again later" — are deliberately
    excluded, because this gate reads the whole page and a false positive
    discards a turn that already succeeded.
  - Nothing checked capacity on the **send** path. When the notice arrives as a
    modal it covers the composer, so the send never lands:
    `clickOrFallbackToEnter` burned its four retries and threw a generic
    "failed to trigger send", leaving the provider un-flagged — the tier chain
    could not route around it and the next attempt met the same modal. A failed
    send now asks the page whether it is a capacity refusal, tags the error
    `rateLimited` so `promptWorkflow` hands off cleanly, and dismisses the modal
    so the tab is reusable.
- DeepSeek: `setDeepSeekMode` now always disables the web **Search** toggle. When
  Search was left on (it persists across sessions), DeepSeek augmented replies with
  web results and conversational framing, corrupting strict-JSON responses and
  wasting the turn. Search is now turned off proactively on every prompt.

## [1.0.0] - 2026-04-29

### Added

- Initial public release
- REST API server (`/api/ask`, `/api/sessions`, `/api/ping`, `/api/agent`, `/api/navigate`, `/api/screenshot`, `/api/prompt`)
- Session pooling with per-provider browser tabs
- Support for ChatGPT, Google Gemini, Microsoft Copilot (Personal), Microsoft 365 Copilot (Work), DeepSeek, and xAI Grok
- Interactive provider setup wizard (`npm start`)
- Server-sent events endpoint (`/api/sync`) for real-time sync events
- Audit tool (`npm run audit`) with 5-step motion test for each provider
  - Per-step viewport screenshots saved to `reports/`
  - Locator probe diagnostics on failure
  - `--provider <name>` flag for single-provider targeted runs
  - `--ci` flag for non-interactive CI mode
- Auto-fix tool (`npm run audit:fix`) that generates updated locator suggestions from failure HTML
- Self-healing locator heuristics (`src/heal/localHealer.js`)
- Chrome auto-launch with CDP connection, retry loop, and WSL2 port-release polling
- Graceful shutdown with `R` (re-setup) and `Q`/Ctrl+C hotkeys
- Rate limiting (100 req / 15 min per IP on `/api/`)
- Request timeout disabled for long-running AI generation calls
- Port-in-use recovery: kills stale process and polls until port is released before retry

### Provider-specific notes

- **ChatGPT**: Switched to ProseMirror contenteditable; input uses clipboard paste to avoid 30s timeout
- **Copilot (Personal)**: Uses `Enter` key submission to trigger React's `onKeyDown` handler; doneSignal scoped to AI message element to avoid false positives from user-message copy button
- **Gemini / Copilot 365**: Uses clipboard paste for Quill/Lexical contenteditable editors
- **DeepSeek**: Supports Fast / Expert (DeepThink R1) mode toggle audit step
- **Gemini**: Supports Pro / Thinking / Fast model dropdown audit step

[Unreleased]: https://github.com/jeffrey-nz/browser-ai-bridge/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/jeffrey-nz/browser-ai-bridge/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/jeffrey-nz/browser-ai-bridge/releases/tag/v1.0.0
