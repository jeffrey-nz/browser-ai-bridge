# browser-ai-bridge

A local REST API server that automates real browser sessions to interact with AI web interfaces. No API keys required — it logs into AI services as a normal user would and drives them programmatically via [Playwright](https://playwright.dev/) over the Chrome DevTools Protocol (CDP).

## Supported providers

| Provider          | ID           | Prompt limit (chars) |
| ----------------- | ------------ | -------------------- |
| ChatGPT           | `chatgpt`    | 150,000              |
| Google Gemini     | `gemini`     | 150,000              |
| DeepSeek          | `deepseek`   | 150,000              |
| xAI Grok          | `grok`       | 150,000              |
| Microsoft Copilot | `copilot`    | 9,500                |
| Kimi              | `kimi`       | 100,000              |
| Qwen              | `qwen`       | 100,000              |
| Z.ai (GLM)        | `zai`        | 100,000              |
| Mistral Le Chat   | `mistral`    | 100,000              |
| Perplexity        | `perplexity` | 100,000              |

The last five share one spec-driven implementation (`src/ai/generic/specs.js`).
Set `BROWSER_AI_PROVIDERS=chatgpt,gemini` to start only some of them.

## How it works

```
Your app → POST /api/ask → browser-ai-bridge
                               └── Playwright CDP → Chrome tab (logged-in AI session)
                                       └── streams response back
```

The server keeps warm, logged-in browser tabs per provider (a janitor caps them
at `MAX_TABS_PER_PROVIDER`, default 3). When you send a prompt, the server types
it into the right tab, waits for the AI to finish generating, and returns the
full response text.

## Requirements

- **Node.js** >= 20
- **Google Chrome** installed (the server auto-launches it on start)
- Active browser logins for whichever providers you want to use

## Installation

### npm (recommended)

```bash
npm install browser-ai-bridge
```

Run directly without installing:

```bash
npx browser-ai-bridge
```

### From source

```bash
git clone https://github.com/jeffrey-nz/browser-ai-bridge.git
cd browser-ai-bridge
npm install
cp .env.example .env
```

## Configuration

Edit `.env` to customise the port, CDP address, log level, etc. The defaults work for most setups:

```env
PORT=3333
CDP_URL=http://127.0.0.1:9222
LOG_LEVEL=info
```

[`.env.example`](.env.example) lists every option, including `PROVIDER_TIERS`
(fall through to another provider when one is rate-limited — see
[API.md](API.md#provider-tiers--falling-through-a-rate-limit)) and the tab and
session tunables, which are commented out at their defaults.

### Skipping login verification

Set `BROWSER_AI_ASSUME_LOGGED_IN=1` to trust that every provider is already
signed in. The first-run setup then skips the per-provider login detection and
the **Ready / Skip** confirmation entirely — tabs are still opened/reused so the
providers are primed, but nothing is verified and you're never prompted. Useful
when your Chrome profile already has every provider logged in and you just want
the bridge to come up unattended.

```bash
BROWSER_AI_ASSUME_LOGGED_IN=1 npm start
```

## First-run setup

On first start, an interactive wizard opens Chrome and walks through authenticating each provider:

```bash
npm start
```

1. Chrome opens automatically
2. Pick a scope: configure **all** providers, just **one**, or **Skip setup — assume everything is already logged in** to bypass verification entirely
3. For each provider, the wizard navigates to its URL and waits for you to log in
4. Press **Enter** to confirm a provider is ready, or **S** to skip it
5. The API server starts once setup completes

> Tip: choose **Skip setup** (or set `BROWSER_AI_ASSUME_LOGGED_IN=1`) when your Chrome profile already has every provider logged in and you want an unattended start.

After the first login, Chrome keeps the session in its profile directory,
`~/.browser-ai-bridge/<CHROME_TMP>` (or `CHROME_USER_DATA_DIR` if set), so later
starts don't need you to log in again unless a provider's session expires.

## Usage

### Health check

```bash
curl http://localhost:3333/api/ping
```

```json
{
  "status": "ready",
  "browser": "connected",
  "uptime": 42.1,
  "sessions": 2,
  "activeSessions": 1,
  "providers": { "chatgpt": { "name": "ChatGPT", "total": 1 } },
  "mem": { "heapUsedMB": 48, "heapTotalMB": 64, "rssMB": 180 }
}
```

It returns `503` with `"status": "initialising"` until setup has finished.
[API.md](API.md#get-apiping) lists every field.

### Send a prompt

```bash
curl -X POST http://localhost:3333/api/ask \
  -H "Content-Type: application/json" \
  -d '{ "provider": "chatgpt", "prompt": "Explain recursion in one sentence." }'
```

```json
{
  "success": true,
  "response": "Recursion is a technique where a function calls itself to solve smaller instances of the same problem until a base case is reached.",
  "data": null,
  "provider": "chatgpt",
  "turnIndex": 1,
  "sessionAgeMs": 8120,
  "requestId": "uuid"
}
```

`provider` is who actually answered — with `PROVIDER_TIERS` set it can differ
from the one you asked for.

The server automatically creates a session for the provider if one doesn't exist yet.

### Pick the model or reasoning depth

`mode` selects inside the provider's own UI before the prompt is sent — `pro`,
`thinking`, `fast`, or `auto` (default):

```bash
curl -X POST http://localhost:3333/api/ask \
  -H "Content-Type: application/json" \
  -d '{ "provider": "gemini", "mode": "pro", "prompt": "..." }'
```

Gemini falls back Pro → Thinking → Fast when a menu entry is missing. Confirm from
the server log rather than by asking the model, which will cheerfully misreport
itself — see [API.md](API.md#mode-optional).

### Explicit session management

Create a session:

```bash
curl -X POST http://localhost:3333/api/sessions \
  -H "Content-Type: application/json" \
  -d '{ "provider": "gemini" }'
# → { "success": true, "sessionId": "uuid", "maxPromptChars": 150000 }
```

Send to a specific session:

```bash
curl -X POST http://localhost:3333/api/ask \
  -H "Content-Type: application/json" \
  -d '{ "sessionId": "uuid", "prompt": "Continue our conversation..." }'
```

Close a session:

```bash
curl -X DELETE http://localhost:3333/api/sessions/uuid
```

List all active sessions:

```bash
curl http://localhost:3333/api/sessions
```

### Programmatic usage (Node.js)

```js
import { BrowserAIClient } from "browser-ai-bridge/client";

const client = new BrowserAIClient({ baseUrl: "http://localhost:3333" });

// One-shot — server picks or creates a session automatically
const { response } = await client.ask({
  provider: "chatgpt",
  prompt: "Hello!",
});
console.log(response);

// Explicit session — keeps conversation context across turns
const session = await client.createSession("gemini");
const r1 = await session.ask("What is the capital of France?");
const r2 = await session.ask("And its population?");
console.log(r2.response);
await session.close();
```

## API reference

See [`API.md`](API.md) for every endpoint: request and response fields, error
codes, prompt limits, images, `/api/ask-all`, and provider tiers.

## Audit tool

The built-in audit command verifies that all CSS selectors and automation steps are working correctly against each provider's live interface:

```bash
npm run audit
```

This opens an interactive menu to select which providers to test (`--provider
<name>` for one, `--ci` for all without prompts). Each provider runs through 5
standard steps (new chat, input injection, send, generation polling, response
extraction), plus a model/mode step for Gemini and DeepSeek, and reports
pass/fail with per-step screenshots saved to `reports/`.

If a provider fails, `audit:fix` copies a ready-made prompt — the failure report
plus the page's HTML snapshot — to your clipboard, to paste into any LLM for
updated selectors:

```bash
npm run audit:fix
```

## Corpus & diagnostic scripts

Reusable tools under `scripts/`. Run them with `node`; none needs the bridge
running unless noted.

**Vision-probe corpus** (`reports/vision-probe/`)

- `scripts/vision-probe.mjs [--blind] [--count N --color name] [--providers a,b,c]` — sends a fixture image (or, with `--blind`, the same prompt with no image) to providers and grades each reply. `--help` lists every flag.
- `scripts/ia-grade.mjs` — regrades the whole corpus against the current `classify()` and reports how often the `imageAttached` flag was right.
- `scripts/shape-audit.mjs` — recomputes each recorded reply's shape and reports where the stored value and today's classifier disagree.
- `scripts/fixture-audit.mjs` — decodes every fixture PNG and checks its drawn square count matches its declared truth.
- `scripts/pngPixels.mjs` — the shared PNG decoder (a library, imported by `fixture-audit.mjs` and `tests/renderPng.test.js`).
- `scripts/provenance-census.mjs` (`npm run census:provenance`) — how many corpus rows can name the commit that produced them, and where the positive controls sit.
- `scripts/generateCssColorTable.mjs` — regenerates `cssColorTable.json` (CSS colour name → RGB) from a real Chrome over CDP. Deterministic; needs Chrome on `CDP_URL`.

**Live debugging** (need Chrome, and the bridge where noted)

- `scripts/attachment-diagnose.mjs <providerId>` — runs a real upload through `uploadFileToPage` on a live provider tab (bridge running) and reports whether the attachment shows up.
- `scripts/dom-diagnose.mjs <urlSubstr> <mode> [args]` — inspects a live provider page's DOM: selector matches, ancestors of a known text, sibling walk, screenshot. The file header describes the four modes.
- `scripts/serverProvenance.mjs` — fetches `/api/ping` and returns which commit the running server loaded (`loadedCommit`, `loadedTreeDirty`). Import `fetchServerProvenance` from live-verification scripts rather than re-implementing it.

**Repo checks** (run in CI)

- `scripts/check-reachable.cjs` (`npm run check:reachable`) — fails if any `src/` module is unreachable from a declared entry point.
- `scripts/doc-check.mjs` (`npm run check:docs`) — fails if a script listed here is missing, or a script in `scripts/` isn't listed.

One-off probes written for a single ticket belong in `evidence/` with that
ticket's other artifacts (see [CLAUDE.md](CLAUDE.md)). The few still in
`scripts/` because a test imports them carry `// @one-shot-probe` as line 2,
which is how `doc-check.mjs` knows not to require them here.

## Hotkeys (while server is running)

| Key          | Action                       |
| ------------ | ---------------------------- |
| `R`          | Re-run provider setup wizard |
| `Q` / Ctrl+C | Graceful shutdown            |

## Project structure

```
src/
├── ai/               # Per-provider automation logic (selectors, prompt flow, response extraction)
│   ├── chatgpt/
│   ├── copilot/
│   ├── gemini/
│   ├── deepseek/
│   ├── grok/
│   ├── generic/      # Spec-driven providers (kimi, qwen, ...) sharing one implementation
│   └── shared/       # Shared DOM interaction utilities
├── agent/            # /api/agent orchestration
├── audit/            # Audit runner, steps, fix generator, and IO (npm run audit)
├── browser/          # Chrome connection, CDP management, launcher
├── client/           # JS client for the HTTP API (package export "./client")
├── config/           # Provider configuration (names, URLs, prompt limits)
├── heal/             # Page-context capture for stall diagnostics
├── middleware/       # Express error handling and response helpers
├── routes/           # Express routes — one file per /api/* endpoint (see API.md)
├── session/          # Session lifecycle, pooling, locking, tab janitor
├── setup/            # Setup-wizard state behind /api/setup
├── shims/            # Internal utility shims (logger, UI, event bus)
└── startup/          # Provider auth wizard and process management
```

## Platform notes

**Chrome location**: macOS uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
Windows `C:\Program Files\Google\Chrome\Application\chrome.exe`, and Linux the
first of `google-chrome`, `google-chrome-stable`, `chromium-browser` or `chromium`
on `PATH`.

**WSL2**: Chrome cold-start can take 20+ seconds. The server waits up to 60
seconds (`CDP_BIND_TIMEOUT_MS`) for the CDP port before failing.

**Running without a visible window**: `HEADLESS=true` runs true headless Chrome;
`HEADLESS=offscreen` keeps a normal window but places it off-screen. Prefer
`offscreen` for Gemini — true headless triggers a Google account-chooser that
blocks input.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
