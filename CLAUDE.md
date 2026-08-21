# browser-ai-bridge — Claude Code guide

A local HTTP server that drives logged-in Chrome tabs at ChatGPT, Gemini,
DeepSeek, Grok, and Copilot via Playwright/CDP. It's the **bottom layer**
of a three-repo agent system — see
[dev-agent/ARCHITECTURE.md](https://github.com/jeffrey-nz/dev-agent/blob/master/ARCHITECTURE.md)
for the bigger picture.

Public API and user-facing docs live in [README.md](./README.md) and
[API.md](./API.md). This file is for editing the code.

## Top-level shape

```
src/
├── index.js            # Entry — boots server.js, handles SIGTERM
├── server.js           # Express app, middleware, route registration
├── routes/             # HTTP route handlers
├── ai/                 # One folder per provider (chatgpt, gemini, deepseek, ...)
│   └── shared/         # Cross-provider helpers (uploadFile, domInteraction)
├── session/            # SessionManager — pool of browser tabs
├── audit/              # Selector-health audit tool (npm run audit)
├── config/             # Provider configs, constraints
├── stalls.js           # Stall detection (per-session activity tracker)
├── web/                # Event bus for SSE
└── utils/              # Logger, etc.
```

## Hot paths

**`POST /api/ask`** — the route 99% of traffic hits.
[src/routes/ask.js](./src/routes/ask.js) → executes
[`executeAskTurn`](./src/routes/ask/executor/index.js) which:

1. Saves any base64 `images` to temp files (`imageAttachments.js`)
2. Builds the initial prompt with provider-specific constraints
3. Calls [`executeCoreTurn`](./src/routes/ask/executor/coreTurn.js) which
   dispatches to `engine.sendPromptWithFile` (if attachments) or
   `engine.sendPromptAndWait`
4. Handles rate-limit retries, rotation, stalls
5. Cleans up temp files

The engine objects live in `src/ai/<provider>/session.js` and extend
`BaseProvider`.

## How a provider is structured

Each provider directory follows the same pattern (best example: `src/ai/deepseek/`):

```
session.js           # Provider class — sendPromptAndWait, startNewChat, setMode
locators.js          # CSS selectors for input, send, stop, response, etc.
interaction/
├── chat.js          # startNewChat (click "New chat" button)
├── mode.js          # setMode (model/mode switching)
└── prompt/
    ├── index.js     # sendPromptAndWait, sendPromptWithFile entry
    ├── input.js     # Type into editor + upload file
    ├── executeTurn.js  # Inject text, click send, wait, extract
    ├── poll/        # Wait for generation to finish
    └── extract.js   # Pull response text from DOM
```

When adding a new provider, copy the structure of `deepseek/` — it's the
most complete.

## Locators — what they are and why they break

The provider sites change their DOM frequently. `locators.js` files hold
the CSS selectors. The **audit tool** verifies them:

```bash
npm run audit                          # all providers
npm run audit -- --provider Gemini     # one
SHOW_BROWSER=true npm run audit -- --provider Gemini   # head-ful, watch it run
```

The audit goes through standard motions (context reset → input injection
→ submission → polling → extraction) plus per-provider extra steps
(model dropdown, mode toggles). Configured in
[src/audit/providers.js](./src/audit/providers.js).

When a provider breaks, run the audit. The failing step name tells you
which locator to update.

## Session lifecycle

`SessionManager` ([src/session/](./src/session/)) maintains a pool of
warm browser tabs — one per provider. Sessions are:

- **created lazily** on first request to that provider
- **reused** across requests (avoids login delay)
- **rotated** when an AI session hits its context limit (triggers
  `injectRotationHandoff` on the new tab so context isn't lost)
- **recycled** when stalled (no activity within threshold)

Stalls are detected via `markActive` / `markInactive` in `stalls.js`.

## Common pitfalls

- **Browser changes break locators.** When something fails: run the audit
  first, before debugging logic. The reports under `reports/` and
  `snapshots/` are your starting point.
- **Body parser is 50 MB.** Configured in `server.js` to allow image
  uploads. Don't lower it without auditing the image flow.
- **Don't bundle the pool startup with provider creation.** They've been
  decoupled to prevent tab bloat — see commits `7785ecd`, `1c28d98`.
- **`stopBtn` is the truth signal** for generation polling. The "is the
  AI still typing?" check looks for the stop button being visible.
  If a provider re-skins, this locator is the first to verify.
- **Subpath imports** — uses `#ai/...`, `#utils/...`, etc. (declared in
  `package.json#imports`). New top-level folders under `src/` need an
  alias entry.

## Headless / invisible operation

Three modes, controlled by the `HEADLESS` env var:

| `HEADLESS=`       | Chrome flag                       | Notes                                                                                                                                                |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| _unset_ (default) | none                              | Regular headful Chrome window. Use during dev.                                                                                                       |
| `true`            | `--headless=new`                  | True headless. **Triggers a Google account-chooser modal on Gemini** that blocks input — avoid for Gemini. Fine for ChatGPT and others if logged in. |
| `offscreen`       | `--window-position=-32000,-32000` | Visible Chrome, positioned off-screen. Sidesteps anti-bot detection entirely. **Use this for autonomous testing against Gemini.**                    |

Tested headless paths (May 2026):

- `HEADLESS=offscreen` + Gemini → 6/6 audit, agent runs ran fibonacci (402s) and balanced-parens (312s) tasks to completion with reviewer approval.
- `HEADLESS=true` + Gemini → blocked by Google account modal even though login state transfers correctly.

## Tests

```bash
npm test       # node --test (unit tests under tests/)
```

API route validation tests live in `tests/api.test.js`. Integration tests
against real browsers are not feasible in CI — the audit tool plays that
role locally.

## Evidence for live-verified tickets

`reports/*` is gitignored except `reports/vision-probe/*.json` and `*.png`
— it exists for that one probe's own tracked corpus, not as a general
place to commit what a ticket produced while verifying a live change
(a transcript, a before/after `/api/ping` capture, a one-off repro
script). Put that under `evidence/`, named so a reader can tell which
ticket it belongs to (e.g. `evidence/t051-two-turn-transcript.txt`) — it
is not covered by any ignore rule, so a plain `git add` tracks it. A
ticket's artifact quoted only into the crew log is a transcription a
reviewer has to trust; the same file committed under `evidence/` is one
they can open.

## When something breaks

1. Hit `/api/ping` — confirms server is alive and reports memory.
2. Run `npm run audit -- --provider <name> --show-browser` — fastest way to
   see what's broken.
3. Check `logs/` and the SSE event stream for stall/cooldown signals.
