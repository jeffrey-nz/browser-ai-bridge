# browser-ai-bridge HTTP API

A local HTTP API that drives logged-in browser tabs at AI chat sites. Every
answer comes from the provider's own web UI, automated with Playwright over the
Chrome DevTools Protocol — no provider APIs or keys are used.

- [Conventions](#conventions)
- [Providers](#providers)
- [Health — `GET /api/ping`](#get-apiping)
- [Sessions](#sessions)
- [Ask — `POST /api/ask`](#post-apiask)
- [Ask several — `POST /api/ask-all`](#post-apiask-all)
- [Provider tiers](#provider-tiers--falling-through-a-rate-limit)
- [Screenshots & monitoring](#screenshots--monitoring)
- [Other endpoints](#other-endpoints)

---

## Conventions

**Base URL:** `http://127.0.0.1:3333`. The server binds to `127.0.0.1` only;
change the port with `PORT`. If the port is taken at startup, the server kills
the process holding it and retries the same port.

**Bodies** are JSON (up to 50 MB, to allow images).

**Success** responses are `200` with `success: true` and the endpoint's fields
at the top level:

```json
{ "success": true, "response": "…", "requestId": "uuid" }
```

**Errors** use the HTTP status plus `success: false` and an `error` message:

```json
{ "success": false, "error": "Missing prompt", "requestId": "uuid" }
```

Routes that assign a `requestId` (`/api/ask`, `/api/ask-all`, `/api/agent`)
include it in both. When a response carries `retryAfter` (seconds), the
`Retry-After` header is set to the same value.

---

## Providers

| ID           | Name              | Prompt limit (chars) |
| ------------ | ----------------- | -------------------- |
| `chatgpt`    | ChatGPT           | 150,000              |
| `gemini`     | Google Gemini     | 150,000              |
| `deepseek`   | DeepSeek          | 150,000              |
| `grok`       | xAI Grok          | 150,000              |
| `copilot`    | Microsoft Copilot | 9,500                |
| `kimi`       | Kimi              | 100,000              |
| `qwen`       | Qwen              | 100,000              |
| `zai`        | Z.ai (GLM)        | 100,000              |
| `mistral`    | Mistral Le Chat   | 100,000              |
| `perplexity` | Perplexity        | 100,000              |

Limits live in `src/config/providers.js` and, for the last five, in each
`GENERIC_SPECS` entry (`src/ai/generic/specs.js`). `BROWSER_AI_PROVIDERS`
restricts which providers start.

Measured round trip for a one-word answer on a warm tab (a snapshot, not a
guarantee): gemini 13s, copilot 22s, grok 39s, chatgpt 44s, deepseek 46s.

---

## Health

### GET `/api/ping`

Liveness, browser state, and per-provider session counts. Reads only in-memory
state, so it is cheap to poll.

**Response — ready (`200`)**

```json
{
  "status": "ready",
  "browser": "connected",
  "loadedCommit": "b529db8…",
  "loadedTreeDirty": false,
  "uptime": 1234.56,
  "sessions": 2,
  "activeSessions": 1,
  "awaitingOperatorSessions": 0,
  "longRunningSessions": 0,
  "longRunningThresholdMs": 120000,
  "attachedPages": 2,
  "lastUnexpectedPageCloseAt": null,
  "devServers": 0,
  "providers": {
    "gemini": {
      "name": "Google Gemini",
      "total": 1,
      "active": 1,
      "awaitingOperator": 0,
      "idle": 0,
      "cooldown": false,
      "cooldownSeconds": 0
    }
  },
  "mem": { "heapUsedMB": 48, "heapTotalMB": 64, "rssMB": 180 }
}
```

| Field                       | Meaning                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser`                   | `"connected"`, `"connecting"` or `"disconnected"`.                                                                                                                                                                                                                                          |
| `loadedCommit`              | The git commit this process loaded at startup — not today's `HEAD`. Node does not hot-reload, so this is what is actually running.                                                                                                                                                          |
| `loadedTreeDirty`           | Whether the working tree had uncommitted changes when the process started.                                                                                                                                                                                                                  |
| `awaitingOperatorSessions`  | Turns paused for a human to choose retry/skip/manual. Only possible with a TTY operator attached, so **always `0` for API callers** — use `longRunningSessions` instead.                                                                                                                    |
| `longRunningSessions`       | Sessions mid-turn for longer than `longRunningThresholdMs` (default 120000, `LONG_RUNNING_THRESHOLD_MS`). The "is anything stuck?" signal for unattended callers.                                                                                                                           |
| `attachedPages`             | Registered sessions whose browser page is still open. Far below `sessions` means pages died under the bridge. Only informative until dead sessions are garbage-collected (`GC_INTERVAL_MS`, 5 min).                                                                                         |
| `lastUnexpectedPageCloseAt` | ISO timestamp of the last time a registered session's page was found closed without the bridge closing it, else `null`. Unlike `attachedPages`, it survives the dead session being pruned, and resets when any session is next created successfully (pool hit or cold boot).                |
| `providers.<id>.cooldown`   | `true` while that provider's default lane is on cooldown (`cooldownSeconds` remaining), `false` when clear. `null` means the provider has no cooldown writer at all (see `WRITABLE_PROVIDERS` in `src/session/CooldownManager.js`); today every provider has one. Mode lanes aren't listed. |

**Response — starting up (`503`)**

While the setup wizard is still running:

```json
{
  "status": "initialising",
  "setupPhase": "waiting_confirm",
  "browser": "connected"
}
```

Or when the browser isn't reachable:

```json
{
  "status": "initialising",
  "browser": "disconnected",
  "error": "Browser not connected or unresponsive"
}
```

---

## Sessions

A session is one browser tab at one provider. `/api/ask` creates and reuses
sessions for you; use these routes when you want to hold a conversation in a
specific tab.

### GET `/api/sessions`

```json
[
  {
    "id": "uuid",
    "providerId": "chatgpt",
    "createdAt": "2026-09-25T01:23:45.000Z",
    "lastUsedAt": "2026-09-25T01:24:10.000Z",
    "state": "active",
    "pageAttached": true
  }
]
```

This route returns the bare array, without the `success` envelope.

### POST `/api/sessions`

```json
{ "provider": "gemini", "mode": "pro" }
```

`mode` is optional (see [Mode](#mode-optional)).

```json
{ "success": true, "sessionId": "uuid", "maxPromptChars": 150000 }
```

`400` for an unknown provider. `503` if the tab isn't ready within 90 seconds;
the tab is closed if it finishes loading later.

### DELETE `/api/sessions/:id`

`200 { "success": true }`, or `404 { "success": false }` if there is no such
session.

### GET `/api/sessions/:id/snapshot`

A screenshot **and** the page's HTML, for seeing what a session is stuck on. The
HTML is the chat container when one of a fixed list of selectors matches, else
the full page.

```json
{
  "success": true,
  "sessionId": "uuid",
  "providerId": "chatgpt",
  "state": "active | stalled | idle",
  "timestamp": "2026-09-25T01:23:45.000Z",
  "html": "<div>…</div>",
  "screenshotBase64": "<base64-png>",
  "screenshotFailed": false,
  "htmlFailed": false
}
```

Either capture can fail on its own (closed tab, detached frame, timeout) and
comes back as `null` / `""`, which would look like an empty page.
`screenshotFailed` and `htmlFailed` tell the two apart. `screenshotFailed` is
exact; `htmlFailed` is best-effort, since a real page could in principle be
empty.

For a screenshot without HTML, see
[`GET /api/screenshot/session/:id`](#get-apiscreenshotsessionid).

---

## Ask

### POST `/api/ask`

Send a prompt and wait for the complete answer.

```json
{
  "provider": "gemini",
  "mode": "pro",
  "prompt": "Your prompt text",
  "images": ["data:image/png;base64,iVBORw0KGgo…"]
}
```

| Field             | Required            | Meaning                                                                                                                                                                                           |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`          | yes                 | The prompt text. Limited per provider (see [Providers](#providers)).                                                                                                                              |
| `provider`        | this or `sessionId` | Provider id. Reuses an idle tab or opens one. Tier 0 of a chain — see [Provider tiers](#provider-tiers--falling-through-a-rate-limit).                                                            |
| `providers`       | —                   | An ordered chain instead of `provider`, e.g. `["gemini", "chatgpt"]`.                                                                                                                             |
| `fallback`        | —                   | With `provider`: the rest of the chain. `[]` pins to `provider`.                                                                                                                                  |
| `sessionId`       | this or `provider`  | Continue a specific session. Never falls back to another provider.                                                                                                                                |
| `mode`            | —                   | Model or reasoning depth — see [Mode](#mode-optional).                                                                                                                                            |
| `images`          | —                   | Images to attach — see [Images](#images).                                                                                                                                                         |
| `label`           | —                   | Names the turn. Unset or starting with `API Turn` = sent verbatim. Anything else is an agent turn and gets a provider-specific format constraint prepended (`src/config/providerConstraints.js`). |
| `skipConstraint`  | —                   | `true` sends the prompt verbatim even for an agent label.                                                                                                                                         |
| `projectDir`      | —                   | Project path used in DeepSeek's agent constraint.                                                                                                                                                 |
| `clientTimeoutMs` | —                   | How long your client will wait. Past it the bridge treats you as gone, stops retrying and frees the tab, even if the socket still looks open (pooled HTTP clients often keep it).                 |

#### Mode (optional)

`mode` selects the model or reasoning depth in the provider's own UI before the
prompt is sent: `pro`, `thinking`, `fast`, or `auto` (the default). It is applied
when the session is created **and** before each turn, because a reused tab may
have been left on a different setting.

Aliases (`src/ai/modes.js`):

- `thinking`: `thinkdeeper`, `o1`, `o3`, `deepthink`, `r1`, `fun`
- `fast`: `quick`, `4o-mini`, `v3`, `flash`

An unrecognised value quietly becomes `auto`.

Not every provider has every mode. Gemini falls back Pro → Thinking → Fast when a
menu entry is missing. DeepSeek maps `fast` to Standard (V3). Grok 4 always
reasons, so mode has no effect there. A mode that can't be set is logged, and the
turn goes ahead.

**Check the mode in the server log, not by asking the model.** Models misreport
their own identity; Gemini said "I am Gemini 3.7 Flash" in all three modes. The
bridge reads the UI's dropdown and logs what it selected:

```
⚙️  Setting Gemini mode to: Pro...       ✔ Mode confirmed: Pro (3.1 Pro
```

Assert on `Mode confirmed` if a script needs to check.

#### Images

`images` is an array of data URLs (`data:image/png;base64,…`), bare base64
(treated as PNG), or `{ "data": "…", "mimeType": "image/jpeg" }` objects. PNG,
JPEG, GIF and WebP get their proper extension; any other type is uploaded as
`.bin`. **Only the first image is sent** — providers accept one file per turn —
so send one image per call. Temp files are deleted after the turn.

Attaching a file to someone else's page can fail silently, so the bridge waits
for visible evidence (an attachment chip or thumbnail) and reports what it saw:

| `imageAttached` | Meaning                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `true`          | Attachment evidence appeared on the page.                                                                                       |
| `false`         | Not confirmed. Comes with `imageAttachedCause` and a `warning`. **Treat the answer as text-only** — it can sound fluent anyway. |
| absent          | The request had no image. A request with an image always gets `true` or `false`.                                                |

`imageAttachedCause` (`src/ai/shared/uploadOutcome.js`):

| Cause             | Meaning                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `unconfirmed`     | A file was handed to the composer but no evidence appeared in time. The only cause where the image may still have arrived. |
| `not_offered`     | Nothing on the page accepted the file (no file input, no attach button).                                                   |
| `no_upload_path`  | This provider has no image-upload path.                                                                                    |
| `text_only_retry` | A retry inside the turn (stall, rate limit, rotation, cooldown, manual answer) re-sent the prompt without the image.       |
| `upload_error`    | Something unexpected threw during upload.                                                                                  |

Responses may also carry `imageAttachedEvidence` (which selector matched and
how) and, for DeepSeek, `visionModeVerdict`.

**Provider support** (a snapshot of fast-changing sites; run
`node scripts/vision-probe.mjs` for a current reading):

- **Receive images reliably:** gemini, deepseek, grok, copilot, kimi, mistral.
  Kimi and Mistral open a menu before a file input exists; their specs name
  that second click (`secondClickSelector`).
- **chatgpt:** only its hidden file input works (its attach button uses
  `showOpenFilePicker()`, which Playwright can't intercept), and even that is
  unreliable. On chatgpt, `imageAttached: true` can come from a local preview
  alone, so judge by the answer, not the flag.
- **qwen:** the file input accepts the file but nothing on the page changes. A
  confirmed no.
- **zai:** uploads can land, but the only evidence also survives from earlier
  failed drafts, so it is reported `unconfirmed`.
- **perplexity:** on most image turns the composer never appears (roughly 1 in
  10 complete).

Text turns are reliable on chatgpt, gemini, deepseek, grok, copilot, qwen and
mistral. Kimi completes about 3 in 4, zai about 3 in 8, and perplexity about 1
in 10.

A downscaled image is usually enough, and sending less is worth preferring since
the image leaves your machine.

#### Response

```json
{
  "success": true,
  "response": "AI response text",
  "data": null,
  "provider": "gemini",
  "turnIndex": 1,
  "sessionAgeMs": 289,
  "requestId": "uuid"
}
```

- `response`: the answer text.
- `data`: structured data parsed from the answer (for example a JSON array), or
  `null`.
- `provider`: who actually answered, which can differ from the one you asked for
  when a chain is in play.
- `turnIndex`: this session's own turn counter (1 on a fresh session).
- `sessionAgeMs`: how long the session had existed when the turn finished.

If the turn got stuck and was escaped by self-heal, the reply is
`{ "success": true, "selfHealEscape": true, "htmlSnapshot": "…", "response": "", "data": null, "provider": "…" }`.

#### Errors

| Status | When                                                                                                                                              | Extra fields                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `400`  | `Missing prompt`, `Missing provider or sessionId`, `Unknown provider specified: …`                                                                |                                                                  |
| `409`  | `Session is busy processing another prompt`                                                                                                       | `retryAfter: 0.5`                                                |
| `413`  | `Prompt exceeds provider character limit of N`                                                                                                    | `max`                                                            |
| `429`  | The requested provider/mode is on cooldown and there is no fallback tier. The message says how long, and why when known.                          | `retryAfter`                                                     |
| `500`  | `Failed to create session: …`, or any other turn failure                                                                                          |                                                                  |
| `503`  | The turn stalled (`error: "STALLED"`), or the provider stated its own quota window (the message names it, e.g. "grok is out of quota for 18.8h…") | `stalled`, `rateLimited`, `attempted`, `retryAfter` (quota only) |

See [Provider tiers](#provider-tiers--falling-through-a-rate-limit) for the
`503`s a chain can return.

#### Rate limits, cooldowns and blocked pages

- **Detection.** ChatGPT, DeepSeek, Grok and Gemini check their own pages for
  rate-limit notices. The five generic providers use a shared usage-limit
  detector (`src/ai/shared/usageLimit.js`) plus any phrases in their spec, and
  `src/ai/shared/promptWorkflow.js` also scans the answer text itself.
  **Copilot has no limit detection**: a throttle there shows up as a stall or a
  raw error.
- **Cooldowns are per lane.** A lane is `provider` or `provider:mode`, so Gemini
  running out of Fast doesn't block Pro. When the provider states how long the
  limit lasts, the cooldown lasts exactly that long.
- **Blocked accounts.** A suspended account is put on cooldown until the date its
  notice gives (one hour if that date can't be read). A signed-out provider is
  skipped rather than reloaded.
- **Back-off.** With no fallback tier, a rate-limited turn retries after about
  90s, 90s, 120s and 300s (±25% jitter each, roughly 10 minutes in total). It
  stops within seconds once the caller has gone.
- **Poll budget.** Most providers wait up to 300s for an answer. Copilot takes
  its budget from the request instead: 7 minutes, or 3 when `label` matches
  `/reviewer/i`.

---

## Ask several

### POST `/api/ask-all`

The same prompt to several providers at once, returning every answer — for a
second opinion, not a faster single answer.

```json
{
  "providers": ["gemini", "chatgpt", "deepseek", "grok"],
  "prompt": "Your prompt text"
}
```

`providers` is required: a non-empty array of ids, de-duplicated. `mode`,
`label`, `skipConstraint`, `images` and `projectDir` work as on `/api/ask` and
apply to every provider.

```json
{
  "success": true,
  "answers": [
    {
      "provider": "gemini",
      "answered": true,
      "response": "PONG",
      "data": null,
      "turnIndex": 1,
      "sessionAgeMs": 289
    },
    {
      "provider": "zai",
      "answered": false,
      "reason": "Polling timed out (Timeout after 300000ms)"
    }
  ],
  "elapsedMs": 43828,
  "requestId": "uuid"
}
```

- **It never merges, votes or picks a winner.** Agreement between models is weak
  evidence (they can share biases), and a merged answer hides the disagreement,
  which is usually the useful part. You judge.
- **Answered entries** carry the same fields as `/api/ask`, including the image
  fields.
- **Unanswered entries** carry a `reason`:
  - `"cooldown"` (plus `retryAfter`)
  - `"rate_limited"`
  - `"stalled"`
  - `"self_heal_escape"`
  - or the error message, e.g. an unknown provider or a prompt that's too long.

  A provider that didn't answer is not a vote against.

- **Runs in parallel.** Each provider is its own tab, so the batch takes about as
  long as its slowest member: four providers took 44s, against 42.5s for the
  slowest alone.
- **The response waits for every provider**, including one that hangs until its
  poll timeout, and there are no partial results. Leave unreliable providers out
  of batches you wait on.

---

## Provider tiers — falling through a rate limit

`/api/ask` can take an ordered chain instead of a single provider:

```json
{ "providers": ["gemini", "chatgpt", "grok"], "prompt": "..." }
```

`{"provider": "gemini", "fallback": ["chatgpt", "grok"]}` is equivalent. With
neither, `PROVIDER_TIERS` in `.env` supplies the chain for a request that names
only `provider`.

- **Why.** A rate limit belongs to an account and a clock, not the question: one
  provider cooling down says nothing about whether another could answer now.
  Without a chain, a single limit can cost about 10 minutes of back-off.
- **The chain is a preference, not a pool.** Tier 0 is asked whenever it's
  available, so a fallback lasts only as long as the cooldown that caused it.
- **How tiers are skipped.** A tier is skipped without being asked when its
  provider is already on cooldown, and dropped mid-turn when it rate-limits. The
  advance check uses the provider's default lane, so a cooldown on one mode lane
  is found only by trying it.
- **Read `provider` in the reply** — it says who actually answered.
- **A `sessionId` request never falls back:** continuing a conversation in
  another provider's tab would be a different conversation.

### Pinning to one provider

```json
{ "providers": ["gemini"], "prompt": "..." }
```

`{"provider": "gemini", "fallback": []}` is equivalent. The request then fails
when gemini is unavailable instead of being answered by another provider.

**Pin any batch whose answers are compared with each other.** In one measured
run of 24 identical questions sent as `provider: "gemini"` with `PROVIDER_TIERS`
set, 13 were answered by chatgpt or grok, which gave very different answers.
Every reply named its real `provider`, but a caller treating the batch as one
population would have mixed three models. Pinning also surfaces a rate limit at
once instead of making each call slower.

### When the chain fails

Both failures are `503` with `error: "STALLED"` and an `attempted` array
recording what the chain tried.

A tier's own turn stalled. Stalling never falls through, so this can happen on
tier 0 with `attempted` empty:

```json
{
  "success": false,
  "error": "STALLED",
  "stalled": true,
  "rateLimited": false,
  "attempted": [],
  "requestId": "uuid"
}
```

Every tier was unavailable. This happens only when the last tier was skipped for
cooldown; a last tier that rate-limits or can't open a session returns its own
error instead.

```json
{
  "success": false,
  "error": "STALLED",
  "stalled": true,
  "rateLimited": true,
  "retryAfter": 42,
  "attempted": [
    { "provider": "gemini", "outcome": "cooldown" },
    { "provider": "chatgpt", "outcome": "rate limit" }
  ],
  "requestId": "uuid"
}
```

- `retryAfter` and `Retry-After` give the **shortest** remaining wait, which is
  when the chain comes back.
- `rateLimited` is `true` only if some entry's `outcome` is `"rate limit"`.
- `outcome` values:
  - `"cooldown"`: skipped because the provider was cooling down.
  - `"rate limit"`, spelled with a space, unlike ask-all's `"rate_limited"`: it
    rate-limited mid-turn.
  - Otherwise, the raw error from opening a session. Log it, don't pattern-match
    it.

---

## Screenshots & monitoring

### GET `/api/screenshot`

Opens a fresh page at `url`, captures a PNG, and closes the page.

| Query      | Default | Notes                                        |
| ---------- | ------- | -------------------------------------------- |
| `url`      | —       | Required, http(s); unsafe URLs are refused   |
| `width`    | 1280    | 320–3840                                     |
| `height`   | 900     | 200–2160                                     |
| `fullPage` | false   | `true` for the whole scroll height           |
| `delay`    | 0       | Extra wait in ms before capture, ≤10000      |
| `darkMode` | false   | `true` emulates `prefers-color-scheme: dark` |

```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "screenshotBase64": "<base64-png>",
  "viewport": { "width": 1280, "height": 900 },
  "fullPage": false,
  "darkMode": false,
  "timestamp": "2026-09-25T01:23:45.000Z"
}
```

### GET `/api/screenshot/session/:id`

The current state of a live session's page, without navigating.

```json
{
  "success": true,
  "sessionId": "uuid",
  "providerId": "chatgpt",
  "screenshotBase64": "<base64-png>",
  "fingerprint": "a1b2c3d4e5f6a7b8",
  "timestamp": "2026-09-25T01:23:45.000Z"
}
```

### GET `/api/screenshot/sessions`

The same capture for every active session:
`{ "success": true, "count": 2, "sessions": [ … ] }`.

### GET `/api/screenshot/monitor`

Change detection across sessions. The first call records a baseline per
session; later calls compare against it, and the baseline moves forward
whenever a change is reported.

```json
{
  "success": true,
  "changed": 1,
  "total": 2,
  "timestamp": "2026-09-25T01:23:45.000Z",
  "report": [
    {
      "sessionId": "uuid",
      "providerId": "chatgpt",
      "status": "changed",
      "changed": true,
      "fingerprintChanged": true,
      "visualChanged": true,
      "visualDriftPct": 12,
      "fingerprint": { "previous": "a1b2…", "current": "f8e7…" },
      "baselinedAt": "2026-09-25T01:20:00.000Z",
      "screenshotBase64": "<base64-png>",
      "timestamp": "2026-09-25T01:23:45.000Z"
    }
  ]
}
```

- `status`: `"baselined"` (first sight, no `changed` field), `"stable"` or
  `"changed"`.
- `fingerprintChanged`: the DOM fingerprint differs.
- `visualChanged`: the PNG's hash differs.
- `visualDriftPct`: the percentage change in PNG **byte size**. It's a rough
  proxy, not a pixel diff.
- A session that can't be captured appears as
  `{ "sessionId", "providerId", "error" }`.

### POST `/api/screenshot/baseline/:id`

Resets one session's baseline, for example after starting a new chat on
purpose. Returns `{ success, sessionId, providerId, fingerprint, timestamp }`.

---

## Other endpoints

Registered in `src/server.js`, one file each under `src/routes/`, whose header
comments document the full body and response.

| Method & path                                                                                             | What it does                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/ping/warmup`                                                                                    | Connects to Chrome over CDP now; `503` if it can't.                                                         |
| `GET /api/setup`                                                                                          | Current setup-wizard state.                                                                                 |
| `POST /api/setup/confirm`, `/api/setup/skip`                                                              | Answer a pending wizard prompt; `409` if none is pending.                                                   |
| `GET /api/tabs`                                                                                           | Tab census per provider, and what the tab janitor would close.                                              |
| `POST /api/tabs/sweep`                                                                                    | Run the tab janitor now.                                                                                    |
| `GET /api/sync`                                                                                           | Server-sent events stream of `sync_event`s.                                                                 |
| `POST /api/sessions/:id/control`                                                                          | Answer a stalled turn: `action` is `keep_waiting`, `retry`, `skip`, `manual` (needs `text`) or `self_heal`. |
| `GET /api/sessions/:id/status`                                                                            | Whether the session exists, and its stall state.                                                            |
| `POST /api/sessions/:id/new-chat`                                                                         | Start a fresh conversation in that tab.                                                                     |
| `POST /api/sessions/:id/evaluate`                                                                         | Run `{ script }` in the session's page; returns `{ result }`.                                               |
| `GET /api/sessions/:id/extract-image`                                                                     | The AI-generated image on the page, as base64 (`?minSize=`, default 512).                                   |
| `POST /api/agent`                                                                                         | Multi-turn tool-using agent loop (`src/agent/`): `{ sessionId?, provider?, prompt, maxTurns? }`.            |
| `POST /api/prompt`                                                                                        | Type a prompt into a session and return without waiting for the reply.                                      |
| `POST /api/navigate`                                                                                      | Bring the browser forward and navigate to `{ url }`.                                                        |
| `POST /api/visual-ask`                                                                                    | Screenshot a running web app, upload it to a provider, and return a QA report.                              |
| `POST /api/image-ask`                                                                                     | Upload an existing image (path or base64) and ask about it.                                                 |
| `POST /api/audio-ask`                                                                                     | Upload an existing audio clip (path or base64) and ask about it.                                            |
| `GET /api/page-inspect?url=`                                                                              | Load a URL; return `#root` HTML, error-overlay text, console errors, and whether anything rendered.         |
| `POST /api/evaluate`                                                                                      | Load a URL and run JavaScript in it.                                                                        |
| `POST /api/click`                                                                                         | Load a URL, click a selector, return the resulting DOM.                                                     |
| `POST /api/wait-for`                                                                                      | Load a URL and wait for a selector to appear.                                                               |
| `POST /api/devserver`, `GET /api/devserver`, `GET /api/devserver/logs/:pid`, `DELETE /api/devserver/:pid` | Start, list, tail and stop a project's dev server.                                                          |

---

## Notes

- The bridge launches Chrome itself, or attaches to one already listening at
  `CDP_URL` (port `CDP_PORT`, default 9222).
- Sessions are real browser tabs. The tab janitor caps them at
  `MAX_TABS_PER_PROVIDER` (default 3) and closes abandoned ones; see
  `GET /api/tabs`.
