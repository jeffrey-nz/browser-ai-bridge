# browser-ai-bridge

A local REST API server that automates real browser sessions to interact with AI web interfaces. No API keys required — it logs into AI services as a normal user would and drives them programmatically via [Playwright](https://playwright.dev/) over the Chrome DevTools Protocol (CDP).

## Supported providers

| Provider                     | ID           |
| ---------------------------- | ------------ |
| ChatGPT                      | `chatgpt`    |
| Google Gemini                | `gemini`     |
| Microsoft Copilot (Personal) | `copilot`    |
| Microsoft 365 Copilot (Work) | `copilot365` |
| DeepSeek                     | `deepseek`   |
| xAI Grok                     | `grok`       |

## How it works

```
Your app → POST /api/ask → browser-ai-bridge
                               └── Playwright CDP → Chrome tab (logged-in AI session)
                                       └── streams response back
```

The server maintains a pool of persistent browser tabs — one per AI provider — each already logged in. When you send a prompt, the server injects it into the correct tab, waits for the AI to finish generating, and returns the full response text.

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

See [`.env.example`](.env.example) for all available options.

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

After initial login, Chrome saves the session to a temp profile directory (`/tmp/chrome_ai_debug` by default). Subsequent starts don't require re-authentication unless sessions expire.

## Usage

### Health check

```bash
curl http://localhost:3333/api/ping
```

```json
{
  "status": "ready",
  "browser": { "connected": true },
  "uptime": 42.1,
  "sessions": 2
}
```

### Send a prompt

```bash
curl -X POST http://localhost:3333/api/ask \
  -H "Content-Type: application/json" \
  -d '{ "provider": "chatgpt", "prompt": "Explain recursion in one sentence." }'
```

```json
{
  "success": true,
  "response": "Recursion is a technique where a function calls itself to solve smaller instances of the same problem until a base case is reached."
}
```

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
# → { "success": true, "sessionId": "uuid" }
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
const { data } = await client.ask({ provider: "chatgpt", prompt: "Hello!" });
console.log(data.response);

// Explicit session — keeps conversation context across turns
const session = await client.createSession("gemini");
const r1 = await session.ask("What is the capital of France?");
const r2 = await session.ask("And its population?");
await session.close();
```

## API reference

See [`API.md`](API.md) for the full endpoint documentation including request/response schemas, error codes, and prompt length limits.

## Audit tool

The built-in audit command verifies that all CSS selectors and automation steps are working correctly against each provider's live interface:

```bash
npm run audit
```

This opens an interactive menu to select which providers to test. Each provider runs through 5 standard steps (new chat, input injection, send, generation polling, response extraction) and reports pass/fail with per-step screenshots saved to `reports/`.

If a provider fails, the auto-fix command uses an LLM session to analyse the failure HTML and suggest updated selectors:

```bash
npm run audit:fix
```

## Corpus & diagnostic scripts

Reusable tools under `scripts/` — reached for repeatedly across tickets, not tied to one closed one. Run directly with `node`, no bridge required unless noted:

- `scripts/vision-probe.mjs [--blind] [--count N --color name] [--providers a,b,c]` — sends a fixture image (or, with `--blind`, the same prompt with no image at all) to one or more providers and grades the reply against ground truth. `--help` for the full flag list.
- `scripts/ia-grade.mjs` — regrades the whole `reports/vision-probe/` corpus against the current `classify()`, reporting the `imageAttached` flag's refutable/confirming/neither split and the corpus's realised (count,colour) prior alongside the generator's.
- `scripts/shape-audit.mjs` — recomputes every recorded reply's shape fresh and reports where the stored value and today's classifier disagree, plus per-count and per-provider accuracy tables.
- `scripts/fixture-audit.mjs` — decodes every committed fixture PNG's actual pixels and checks the drawn square count matches its declared truth.
- `scripts/pngPixels.mjs` — the one shared PNG pixel decoder (IHDR/IDAT/inflate/un-filter). A library, not a CLI tool — imported by `fixture-audit.mjs` and `tests/renderPng.test.js`; write a caller against this file rather than a second decoder.
- `scripts/attachment-diagnose.mjs <providerId>` — drives a real upload through the production `uploadFileToPage` path against a live provider tab (requires the bridge running) and reports whether attachment evidence appears, before and after.
- `scripts/dom-diagnose.mjs <urlSubstr> <mode> [args]` — inspects a live provider page's DOM (selector matches, ancestor chains of a known text, sibling walk, screenshot) over the bridge's own CDP connection, without touching bridge internals. `--help`-free; see the file header for its four modes.
- `scripts/doc-check.mjs` — checks this section against `scripts/` itself: every script named above still exists on disk, and every script on disk that isn't marked `@one-shot-probe` in its own header is named above. Run it after adding or removing a script.

One-shot, closed-ticket evidence probes also live under `scripts/` (marked `// @one-shot-probe` in their own header — `doc-check.mjs` uses that marker, not a filename pattern, to tell the two apart) and are not listed here; see the ticket named in each file's header for context.

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
│   └── shared/       # Shared DOM interaction utilities
├── audit/            # Audit runner, steps, fix generator, and IO
├── browser/          # Chrome connection, CDP management, launcher
├── config/           # Provider configuration (names, URLs, prompt limits)
├── heal/             # Selector repair heuristics
├── middleware/        # Express error handling and response helpers
├── routes/           # Express routes (/api/ask, /api/sessions, /api/agent, /api/ping)
├── session/          # Session lifecycle, pooling, locking
├── shims/            # Internal utility shims (logger, UI, event bus)
└── startup/          # Provider auth wizard and process management
```

## Platform notes

**WSL2**: Chrome cold-start can take 20+ seconds on WSL2. The server waits up to 40 seconds for the CDP port to become available before failing.

**macOS**: Chrome is expected at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

**Linux / CI**: Set `HEADLESS=true` in `.env` to run Chrome in headless mode.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
