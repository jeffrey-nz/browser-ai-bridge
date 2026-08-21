# AI Browser Automation API

A local HTTP API that controls existing browser tabs to interact with
AI services such as ChatGPT, Copilot, Gemini, DeepSeek, and Grok.

The API maintains long‑lived browser sessions and automates user‑visible
interfaces using Playwright over Chrome DevTools Protocol (CDP).

---

## Base URL

```

<http://localhost:><port>

```

Default startup port is `3333` (auto‑increments if in use).

---

## Health Check

### GET `/api/ping`

Returns liveness and browser state information.

**Response (ready)**

```json
{
  "status": "ready",
  "browser": { "connected": true },
  "uptime": 1234.56,
  "sessions": 2
}
```

**Response (starting up)**

```json
{
  "status": "initialising",
  "browser": { "connected": false },
  "error": "Browser not connected"
}
```

---

## Sessions

### GET `/api/sessions`

List all active sessions.

**Response**

```json
[
  {
    "id": "uuid",
    "providerId": "chatgpt",
    "createdAt": "2026-04-08T01:23:45.000Z"
  }
]
```

---

### POST `/api/sessions`

Create a new AI session.

**Request**

```json
{
  "provider": "chatgpt | gemini | deepseek | grok | copilot | copilot365"
}
```

**Response**

```json
{
  "success": true,
  "sessionId": "uuid"
}
```

---

### DELETE `/api/sessions/:id`

Close and remove a session.

**Response**

```json
{
  "success": true
}
```

---

## Ask (Send Prompt)

### POST `/api/ask`

Send a prompt to an existing session.

**Request**

```json
{
  "sessionId": "uuid",
  "provider": "gemini",
  "mode": "pro",
  "prompt": "Your prompt text",
  "images": ["data:image/png;base64,iVBORw0KGgo…"]
}
```

**Provider (optional)**

`provider` picks the tab to ask instead of an existing `sessionId` — one of
`chatgpt`, `gemini`, `copilot`, `copilot365`, `deepseek`, `grok`. A session is
created for it if none is open.

**It is tier 0 of a chain, not a pin.** If `PROVIDER_TIERS` is set, a request
naming `gemini` can be answered by whatever is next in that chain the moment
gemini is cooling down, and the reply will say so in its `provider` field. That
is usually what you want and occasionally the opposite of it — see
[Pinning to one provider](#pinning-to-one-provider).

Measured round trip for a one-word answer, warm:

| Provider   | Reply |
| ---------- | ----- |
| `gemini`   | 13s   |
| `copilot`  | 22s   |
| `grok`     | 39s   |
| `chatgpt`  | 44s   |
| `deepseek` | 46s   |

**Mode (optional)**

`mode` selects the model or reasoning depth inside the provider's own UI before
the prompt is sent: `pro`, `thinking`, `fast`, or `auto` (default). Aliases are
accepted, so `deepthink`, `r1`, `o3` and `thinkdeeper` all resolve to `thinking`,
and `flash`, `quick` and `v3` resolve to `fast`.

It applies on session creation **and** again before each turn, because a reused
tab may be left on a different toggle by a previous call.

Not every provider has every mode. Gemini falls back Pro → Thinking → Fast if a
menu entry is missing; DeepSeek maps `fast` to Standard (V3); Grok 4 always
reasons, so mode selection there is a no-op handled in the extractor. A mode that
cannot be set is logged and the turn proceeds rather than failing.

**Verify the mode from the server log, not from the model.** Asked which model
was answering, Gemini replied "I am Gemini 3.7 Flash" in `pro`, `thinking` and
`fast` alike — models are unreliable narrators of their own identity. The bridge
reads the UI's own dropdown and says what it selected:

```
⚙️  Setting Gemini mode to: Pro...       ✔ Mode confirmed: Pro (3.1 Pro
⚙️  Setting Gemini mode to: Thinking...  ✔ Mode confirmed: Thinking (3.6 Thinking
⚙️  Setting Gemini mode to: Fast...      ✔ Mode confirmed: Fast (3.6 Flash
```

That line is the evidence the switch took effect. If you need to assert on it in a
script, assert on `Mode confirmed`.

**Images (optional)**

`images` accepts data URLs (`data:image/png;base64,…`) or bare base64. Each is written
to a temp file and the bridge **attempts** to attach it to the provider's composer, then
cleans up the temp file after the turn. PNG, JPEG, GIF and WebP are recognised; anything
undecodable is skipped with a warning rather than failing the request.

**"Attempts" is not a hedge — attaching a file to a page the bridge does not control can
fail silently, and for a long time it did.** `setInputFiles` on a hidden `<input
type="file">` resolves as soon as the DOM element's `.files` list is set, even when that
element is an unrelated input the page never wired to its composer — so the bridge could
report `success: true` with a fluent-sounding answer for a turn the model never actually
saw a picture in (crew board T-001). The upload path now waits for visible evidence in
the page — an attachment thumbnail or chip — before calling itself done, and the response
carries that verdict:

- `imageAttached: true` — evidence of the attachment appeared on the page.
- `imageAttached: false`, plus a `warning` field — no evidence appeared, a retry inside
  the turn (a stall retry, a rate-limit retry, a chat rotation) re-sent the prompt as text
  only and the original attachment did not survive it, or the provider has no
  file-upload path at all and the image could not be sent by any means. **Treat the
  response as text-only in this case** — the model may answer fluently about an image
  it never received.
- Field absent — the turn carried no image at all (nothing to confirm). A request that
  included an image never gets a bare `success: true` with this field absent — one of
  the two states above always applies instead (crew board T-004).

As of the T-001 measurement, `chatgpt`, `gemini`, `deepseek`, `grok` and `copilot` can be
verified as receiving an image on a given turn; `kimi` and `zai` could not complete an
image turn at all in repeated runs (submit failure / timeout, independent of the image);
`mistral` and `qwen` were seen returning an unrelated answer (the extractor reading the
wrong element on the page) rather than confirming or denying the image. This is a snapshot
of flaky, provider-controlled UIs, not a permanent scorecard — re-run
`node scripts/vision-probe.mjs` for a current reading before depending on a specific
provider's image path.

**Only the first attachment is sent** — the current providers accept one file per turn.
Additional entries are logged and dropped, so send one image per `/api/ask` call.

Useful for anything the caller cannot answer from text alone. It was added for image
transcription, and reading a page of sheet music is a good example: asking Gemini which
bars contain a dotted note found 11 of 11 on a page where the OMR engine found 2 of 15.
A downscaled greyscale PNG (~70KB) was enough — there is no need to send a full-size
scan, and sending less is worth preferring since the image leaves the machine.

**Rules**

- Prompt length is enforced per provider.
- Limits:
  - ChatGPT: 150,000 chars
  - Gemini: 150,000 chars
  - DeepSeek: 150,000 chars
  - Grok: 150,000 chars
  - Copilot: 32,000 chars
  - Copilot 365: 100,000 chars

**Success Response**

```json
{
  "success": true,
  "response": "AI response text"
}
```

**Prompt Too Large**

```json
{
  "error": "Prompt exceeds maximum length for Microsoft Copilot 365 (100000 chars)",
  "maxChars": 100000,
  "actualChars": 152341
}
```

---

## Ask All Providers (Consensus Input)

### POST `/api/ask-all`

The same prompt, N independent providers, N answers — for callers that need a
second and third opinion to catch a single model's hallucination, not a faster
way to ask one question (crew board T-002).

**Request**

```json
{
  "providers": ["gemini", "chatgpt", "deepseek", "grok"],
  "prompt": "Your prompt text",
  "images": ["data:image/png;base64,iVBORw0KGgo…"]
}
```

`providers` is required — a non-empty array of provider ids, de-duplicated
automatically (asking the same provider twice would be the same opinion
counted twice, not a second one). `mode`, `label`, `skipConstraint`,
`images` and `projectDir` behave exactly as they do on `/api/ask` and apply
identically to every named provider.

**This endpoint does NOT merge, vote, or pick a winner.** Two models agreeing
is weak evidence on its own — they can share a training bias — and the moment
a consensus endpoint collapses N answers into one, a caller can no longer see
the disagreement, which is usually the actual signal. It returns the raw set;
the caller adjudicates.

**Response**

```json
{
  "success": true,
  "answers": [
    {
      "provider": "gemini",
      "answered": true,
      "response": "PONG",
      "data": null,
      "messageCount": 0
    },
    {
      "provider": "chatgpt",
      "answered": true,
      "response": "PONG",
      "data": null,
      "messageCount": 0
    },
    {
      "provider": "zai",
      "answered": false,
      "reason": "Polling timed out (Timeout after 300000ms)"
    }
  ],
  "elapsedMs": 43828
}
```

Every entry names its provider. `answered: true` entries carry `response` /
`data` / `messageCount` (and `imageAttached` / `warning` when the request
included an image — same honesty contract as `/api/ask`, see above).
`answered: false` entries carry a `reason` instead — `"cooldown"`,
`"rate_limited"`, `"stalled"`, or the underlying error — and are how a
provider that timed out or never started is distinguished from one that
disagreed: an absence is not a vote against, and nothing about the shape of
the response lets a caller confuse the two.

**Runs in parallel**, not in series: each provider is its own already-open
browser tab, so N requests cost close to what the slowest single one costs,
not the sum. Measured: 4 providers (gemini/chatgpt/deepseek/grok) answered in
44s as a batch, against a solo call to the slowest member of that same batch
(chatgpt) taking 42.5s alone — the ~1.5s difference is fixed per-request
overhead, not serialization.

**The whole response waits for the slowest named provider**, including one
that hangs all the way to its poll timeout. Asking `zai` (currently unable to
complete a turn reliably — see the images section above) alongside two
providers that each answered in under 20s still took just over 5 minutes,
because the response is one JSON object covering every named provider, not a
stream — there is no partial-results path today. Keep that in mind before
naming a provider known to be unreliable in a batch a caller is waiting on
synchronously.

### POST `/api/heal`

Automatically repairs broken CSS selectors for an AI provider by using
another AI session to analyze the DOM.

**Request**

```json
{
  "targetSessionId": "uuid",
  "helperSessionId": "uuid"
}
```

**Response**

```json
{
  "success": true,
  "changesMade": 3,
  "selectors": {
    "inputBox": "...",
    "sendBtn": "...",
    "stopBtn": "...",
    "lastResponse": "..."
  }
}
```

---

## Screenshots & Session Monitoring

### GET `/api/screenshot?url=<url>`

Navigates a fresh browser page to the given URL, captures a PNG screenshot, then closes the page. Returns the image as a base64 string.

**Query Parameters**

| Param | Required | Description               |
| ----- | -------- | ------------------------- |
| `url` | Yes      | HTTP/HTTPS URL to capture |

**Response**

```json
{
  "success": true,
  "url": "https://chatgpt.com",
  "screenshotBase64": "<base64-png>",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### GET `/api/screenshot/session/:id`

Captures the **current state** of a live AI session's page without navigating away. Useful for seeing what a session is displaying right now.

**Response**

```json
{
  "success": true,
  "sessionId": "uuid",
  "providerId": "chatgpt",
  "screenshotBase64": "<base64-png>",
  "fingerprint": "a1b2c3d4e5f6a7b8",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### GET `/api/screenshot/sessions`

Captures all active sessions in one call.

**Response**

```json
{
  "success": true,
  "count": 2,
  "sessions": [
    {
      "sessionId": "uuid",
      "providerId": "chatgpt",
      "screenshotBase64": "<base64-png>",
      "fingerprint": "a1b2c3d4e5f6a7b8",
      "timestamp": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### GET `/api/screenshot/monitor`

Change-detection report across all active sessions. On the first call each session is **baselined** (snapshot stored). Subsequent calls compare the current state against the baseline and report what changed. Baselines are automatically updated when a change is detected.

`fingerprintChanged` reflects structural/content changes (DOM structure). `visualChanged` reflects any pixel-level difference. Either triggers `changed: true`.

**Response**

```json
{
  "success": true,
  "changed": 1,
  "total": 2,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "report": [
    {
      "sessionId": "uuid",
      "providerId": "chatgpt",
      "status": "changed",
      "changed": true,
      "fingerprintChanged": true,
      "visualChanged": true,
      "visualDriftPct": 12,
      "fingerprint": {
        "previous": "a1b2c3d4e5f6a7b8",
        "current": "f8e7d6c5b4a39281"
      },
      "baselinedAt": "2025-01-01T00:00:00.000Z",
      "screenshotBase64": "<base64-png>",
      "timestamp": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

Possible `status` values: `"baselined"` (first call), `"stable"`, `"changed"`.

---

### POST `/api/screenshot/baseline/:id`

Force-reset the stored baseline for a session. Useful after deliberate UI actions (e.g. starting a new chat) so the next `/monitor` call treats the new state as the reference point.

**Response**

```json
{
  "success": true,
  "sessionId": "uuid",
  "providerId": "chatgpt",
  "fingerprint": "f8e7d6c5b4a39281",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Notes

- Requires Chrome running with:
  --remote-debugging-port=9222
- Sessions correspond to real browser tabs.
- No AI provider APIs are used — everything is UI‑driven.

## Provider tiers — falling through a rate limit

`POST /api/ask` takes an ordered chain instead of a single provider:

```jsonc
{
  "providers": ["gemini", "chatgpt", "grok"], // preference order
  "prompt": "...",
}
```

or, equivalently, `{"provider": "gemini", "fallback": ["chatgpt"]}`. With
neither, `PROVIDER_TIERS` in `.env` supplies the fallbacks.

**Why.** A rate limit is a property of an account and a clock, not of the
question. Gemini going into a two-minute cooldown says nothing about whether
ChatGPT could answer the same prompt right now — and the in-turn back-off is
90s, 90s, 120s, 300s, so a single rate limit can cost nine and a half minutes of
doing nothing. A batch that stalls like that has its wall-clock set by its
unluckiest provider.

**The chain is a preference, not a pool.** Tier 0 is asked whenever it is
available, so a fallback lasts exactly as long as the cooldown that caused it
and nothing has to remember to switch back. A tier is skipped without being
asked when it is already cooling down, and dropped mid-turn when it rate-limits.

**The response says who answered:**

```json
{ "success": true, "response": "...", "provider": "chatgpt" }
```

Read it. A caller comparing answers between turns — anything scoring or ranking
— cannot otherwise tell two models apart, and different models are different
scales.

**A `sessionId` request gets no chain**, deliberately: continuing a conversation
in a different provider's tab would be a different conversation wearing the same
id. Fall back at whatever level owns the conversation, not inside one.

### Pinning to one provider

Name a chain of one:

```json
{ "providers": ["gemini"], "prompt": "..." }
```

`{"provider": "gemini", "fallback": []}` is equivalent. Either way the request
fails when gemini is unavailable instead of being answered by somebody else.

**When you want this: any batch whose answers are compared with each other.**
Measured on a real run — 24 score crops, one question, `provider: "gemini"` on
every call, no chain named:

| served by | n   | answered     | median |
| --------- | --- | ------------ | ------ |
| gemini    | 11  | 11 of 11     | 24.5s  |
| chatgpt   | 12  | 2 of 12      | 49.8s  |
| grok      | 1   | hung at 210s | —      |

Asked for gemini on 24 of 24; served by something else on **13 (54%)**. One
column labelled "the answer" held one model that answered 11 times out of 11 and
another that returned `unsure` ten times out of twelve — and mid-run the chain
fell through a second time, to grok, so a single batch contained three models.
The reply carried the right `provider` every time; nothing was hidden. But a
caller who writes `provider: "gemini"` and then treats the results as one
population has silently mixed three scales.

Pinning also surfaces a rate limit immediately instead of paying ~40s a call to
discover it, which is the difference between a batch that stops and tells you and
one that quietly gets slower and less consistent.

When every tier is cooling down the reply is `503 STALLED` with `Retry-After`
set to the **shortest** remaining wait — that is when the chain comes back, and
reporting tier 0's would send you to sleep past a provider that was already free.
