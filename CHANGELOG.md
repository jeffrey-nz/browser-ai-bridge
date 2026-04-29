# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jeffrey-nz/browser-ai-bridge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jeffrey-nz/browser-ai-bridge/releases/tag/v1.0.0
