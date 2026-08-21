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
  "browser": "connected",
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
  }
}
```

**`awaitingOperatorSessions`** (crew board T-003, renamed from `stalledSessions`) — a
session's turn is paused waiting for a HUMAN to choose retry/skip/manual (`registerStall`
in `src/stalls.js`). That path is only ever reached when a TTY operator is attached
(`src/routes/ask/executor/stallLoop.js`); a non-interactive turn that fails instead
auto-skips and throws. **This field is always `0` for an unattended/API caller** — that is
its structural range, not a health signal, and it should not be read as "nothing is
stuck." Poll `longRunningSessions` for that instead.

**`longRunningSessions`** — sessions that have been mid-turn (actively awaiting a
response) for longer than `longRunningThresholdMs` (120000ms by default — measured
against this repo's own recorded turn-time corpus, `reports/vision-probe/*.json`: 64
healthy turns ranged 7.6s–68.2s, so 120s clears the whole observed range with margin
while still flagging well before a poll's own 300s ceiling). This is the field an
unattended caller can actually act on — no operator required, pure elapsed time.
Override the threshold with the `LONG_RUNNING_THRESHOLD_MS` env var for testing.

**`attachedPages`** — how many currently-registered sessions have a live (not-closed)
browser page right now, read directly rather than inferred from `sessions`. `uptime`
only tells you the Node process is up; a browser-side collapse that leaves the CDP
connection itself intact (every page/context closed underneath it, `status` still
`"ready"`) can climb `uptime` the entire time. Compare `attachedPages` against
`sessions` — a caller about to commit to a long batch should not proceed if `sessions`
is non-zero but `attachedPages` is far lower, or if `attachedPages` is `0` while turns
are supposedly in flight. **Blind spot (crew board T-023):** `attachedPages` is only
informative while a dead session is still registered — a window bounded by the next
GC sweep (`GC_INTERVAL_MS`, 5 minutes by default) or the next call that touches that
session. Once the dead session is pruned, `attachedPages` reads `0`, identical to a
bridge that was simply never asked to do anything. See `lastUnexpectedPageCloseAt`
for the reading that survives past that point.

**`lastUnexpectedPageCloseAt`** — ISO 8601 timestamp of the last time this process
found a _registered_ session's page already closed without this process itself
having asked for that close (a GC sweep or a session-access self-prune discovering
`page.isClosed()`), or `null` if none is outstanding. This is a sticky edge detector,
not a level: it is set the moment a collapse is _discovered_ and stays set — surviving
the registry drain that erases `attachedPages`'s evidence — until a brand-new session
finishes initializing, which is treated as confirmed proof the browser can still open
and drive a live page. A caller polling before a batch, with `sessions: 0` and
`attachedPages: 0` on both a healthy idle bridge and one whose pages were just killed
underneath it, can tell the two apart here: `null` on the healthy bridge, a timestamp
on the collapsed one. Costs nothing per poll — both values `/api/ping` reads for this
field are already maintained synchronously elsewhere; the endpoint makes no new
`await` against the browser. Blind spot: it can only fire once a dead session is
actually _discovered_ (GC tick or an access attempt) — a collapse nothing has touched
yet is invisible here too, same as `attachedPages`, until something touches it or the
next GC tick runs.

**Response (starting up)**

```json
{
  "status": "initialising",
  "browser": "connected",
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

Per `reports/vision-probe/after-ask.json` (the T-001 measurement), only `gemini`,
`deepseek`, `grok` and `copilot` — 4 providers — can be verified as receiving an image on
a given turn. `chatgpt` is NOT in that set: the same run recorded it as `SEES_NO` with
`imageAttached: false`, i.e. it answered fluently without ever having seen the picture —
exactly the failure mode this section exists to catch, not an exception to it. `kimi` and
`zai` could not complete a turn at all in that same measurement; `kimi`'s cause was found
and fixed (crew board T-006): its `responseBlock` selector (`.message-list`) no longer
existed on the current site, so every completion poll ran out its full timeout regardless
of whether the model had already answered — verified with a real answer ("PONG") sitting
complete on the page while the bridge was still waiting. Selector fix confirmed correct,
but `kimi` still does not complete every turn: 4 runs post-fix, 3 completed in 28-38s
each, 1 ran the full 300s timeout with no answer (confirmed via server-log timestamps to
be after the fix, not a leftover pre-fix result) — call it 3 of 4, not "fixed" outright.
`zai` is not fixed at all and is deliberately excluded from `scripts/vision-probe.mjs`'s
default provider list (T-006): 8 attempts across two sessions completed only 3, with
three distinct, unexplained failure shapes (a submission click that intermittently
doesn't register, a generation that gets stuck showing "Thinking...", and a reply
truncated by exactly one character) rather than one identifiable cause. Still callable by
naming it explicitly; just not part of a sweep nobody asked about it by name.

Two numbers worth keeping separate, named rather than counted by subtraction:

- **Seen to complete a TEXT turn** (n=8, roughly reliable): `chatgpt`, `gemini`,
  `deepseek`, `grok`, `copilot`, `qwen`, `mistral`, `kimi` (kimi ~75%, see above — the
  other 7 have had no observed non-rate-limit failures across this board's sweeps). Below
  roughly even odds but has completed at least once, named with its measured rate: `zai`
  (~3 of 8, ~38%), `perplexity` (~1 of 10, ~10% — see below). All 10 roster providers are
  accounted for above; none are inferred by subtracting a "known-broken" count from 10.
- **Seen to complete a turn AND read an image** (n=4): `gemini`, `deepseek`, `grok`,
  `copilot` — see the `chatgpt` correction above for why it is not a 5th.

**`imageAttached` had never once been `true` for any of the five generic providers — 0 of
21 recorded turns in the corpus this finding was made on (crew board T-014), and at least
one of those 21 falses was wrong.**
`zai`'s upload genuinely lands — a live look confirmed a real attachment card renders in
its composer — but the only class on that card is `chip-scroll`, which
`DEFAULT_ATTACHMENT_EVIDENCE` (`src/ai/shared/uploadFile.js`) does not match, so a
successful attach was reported as `imageAttached: false` and its answer was flagged
"may be text-only" even though the model had genuinely seen the picture (`reports/
vision-probe/t006-zai-r2-run1.json`: a correct count and colour on a freshly-drawn image).
A `GENERIC_SPECS` entry can name its own evidence selector (`attachEvidence`, forwarded by
`src/ai/generic/interaction.js` as `verifySelector`) to fix exactly this — but `zai`'s own
`.chip-scroll` selector was tried and REVERTED on a follow-up check: a negative control
(a brand-new tab, nothing uploaded that turn) still found `.chip-scroll` present and
visible, because zai persists unsent draft attachments against the logged-in account
itself, across tabs, once a submission fails — the same "input did not clear and
generation did not start" fault already documented above leaves its half-sent image
sitting in the composer rather than clearing it. That selector could not tell "attached
this turn" from "an earlier turn's stuck draft", so it would have reported
`imageAttached: true` on every future `zai` turn regardless of that turn's own outcome —
worse than the bug. `zai` is back to reporting `imageAttached: false` unconfirmed, the
conservative, correct-when-uncertain default, until a selector that identifies one specific
turn's own chip is found, or the stuck-draft accumulation itself is fixed. The other four
generic providers were checked the same way, live, and were not the same bug: `kimi` and
`mistral` genuinely do not attach through the code as it stands today (both require a menu
click before any file input exists — `kimi`'s composer opens an "Add files & photos"
submenu, `mistral` has no `input[type="file"]` anywhere in the DOM until some other
interaction reveals one — a different, unfixed gap, not a blind selector), and `perplexity`
never reached a composer at all — the same paywall interstitial T-008 already documented.
`qwen` is now confirmed rather than unconfirmed (crew board T-022, re-run 2026-08-21 with
the improved instrument T-020/T-021 gave it — a before-AND-after count on every selector,
UNUSABLE decided by visibility rather than count): `setInputFiles` against its real,
present `input[type="file"]#filesUpload` does not throw — confirmed via a
`LOG_LEVEL=debug` re-run, which logged `src/ai/shared/uploadFile.js`'s own
"setInputFiles ... did not throw, but no attachment evidence appeared" line, not
inferred from the generic top-level error message alone — but 10 selectors — the shared
default, plus a widened sweep including the `chip` pattern that caught `zai`'s card — all
read `0,false` before the upload and `0,false` after it. Nothing in the composer changes at
all; the input accepts the file and the page shows no acknowledgment of it whatsoever, not
even a hidden node that becomes visible. `qwen` joins `kimi` and `mistral` as a confirmed
no, with its own distinct cause from either of theirs — naming a selector is not possible
here because nothing appeared for one to name. So the image-capable count above stays
correctly capped at the four bespoke providers. As the corpus stands now, as of `9bb68d6`, the
generic path's `imageAttached` is 1 `true` of 24 recorded turns (23 `false`) — not 0 of
21; this ticket's own work added generic-provider turns to a corpus that is now tracked in
git (crew board T-017), and the founding "0 of 21" above is the measurement that started
this ticket, not the live count. The one `true` — `reports/vision-probe/
t014-zai-run1.json` — is the reverted `.chip-scroll` fix's own output, kept in the corpus
as an accurate record of what that code produced at the time, not a claim about the
current tree; the code that produced it no longer exists. Every one of the 23 `false`
readings is either confirmed correct (kimi, mistral, perplexity, qwen — see T-022 above) or
unconfirmed either way (zai) — none is known to be wrong the way the pre-revert fix would
have made `zai`'s appear.

`mistral` and `qwen` were seen returning an unrelated answer — the extractor's response
selector could also match the USER's own turn, so a fast reply could be captured before
the assistant's message ever rendered, echoing the prompt back; mistral separately showed
a bare timestamp for the same underlying reason (its turn's chrome — timestamp, feedback
row — could render, and stabilize, before the model's own text did). Both fixed in T-005
(`src/ai/generic/specs.js`'s `responseBlock` selectors now exclude the user's own turn;
`src/ai/generic/interaction.js`'s completion poll now judges stability on text with the
same chrome stripped, not the raw block). Live-verified three consecutive sweeps each:
neither provider echoes or leaks chrome anymore — both now report an honest `SEES=no`
(a real, upload-related limitation, not this extractor bug).

`perplexity` cannot complete an image turn reliably (crew board T-008): its composer
locator (`div#ask-input`) times out waiting to become visible on most image turns — a
DOM swap (route change / paywall interstitial) that a page reload does not consistently
undo. Measured across ~10 attempts in one session, roughly one in ten completed. An
attempted fix (extending the existing one-retry recovery to two) made no measurable
difference and was reverted rather than shipped for no gain — this is not a "selector
needs updating" fault the way T-005's was. **Do not pick `perplexity` as a second
independent reader** — a caller that does gets what score-reader's default pool got
before T-008: a "pool" that is really one vendor, silently. See T-008 for the located
failure if picking this back up.

**A two-vendor cross-check does remain available on crop-sized images** — this is a
crop-sized result, not a re-quote of the full-page sweep above. `gemini` + `copilot`
agreed on clef 3 of 3 times on real 3.5 KB crops in 101s total, against perplexity's
2575s for zero readings on 9 crops. (Key signature disagreed on all 3 of those —
worth knowing before trusting that field specifically, and it has its own mechanical
adjudicator in score-reader rather than needing a second model.) score-reader's
`DEFAULT_POOL` was changed to `['gemini', 'copilot']` on this evidence
(score-reader `tools/ask-bridge.mjs`).

This is a snapshot of flaky, provider-controlled UIs, not a permanent scorecard — re-run
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
  "response": "AI response text",
  "provider": "gemini",
  "turnIndex": 1,
  "sessionAgeMs": 289
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
      "turnIndex": 1,
      "sessionAgeMs": 289
    },
    {
      "provider": "chatgpt",
      "answered": true,
      "response": "PONG",
      "data": null,
      "turnIndex": 1,
      "sessionAgeMs": 26
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
`data` / `turnIndex` / `sessionAgeMs` (and `imageAttached` / `warning` when
the request included an image — same honesty contract as `/api/ask`, see
above). `turnIndex` is the session's own turn counter (1 on a fresh
session, incrementing on repeat turns against the same `sessionId`) and
`sessionAgeMs` is how long the session had existed when the turn finished —
together they let a caller collecting a corpus over an unattended run order
its own answers by run position, without a second call to `/api/ping` or
joining `createdAt` back in by wall clock (crew board T-011; replaces a
former `messageCount` field that was computed for one provider of ten,
hardcoded to 0 for the rest, and read by nothing). `answered: false`
entries carry a `reason` instead — `"cooldown"`,
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
