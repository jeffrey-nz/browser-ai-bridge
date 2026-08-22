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
    },
    "copilot": {
      "name": "Microsoft Copilot",
      "total": 0,
      "active": 0,
      "awaitingOperator": 0,
      "idle": 0,
      "cooldown": null,
      "cooldownSeconds": null
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

**`providers.<id>.cooldown` / `cooldownSeconds`** (crew board T-097) — tri-state, not
boolean. `true`/a positive `cooldownSeconds` means that provider is actually on
cooldown right now. `false`/`0` means measured and clear. **`null`/`null` means this
provider has no code path in this repo that can EVER put it on cooldown** — not that it
is clear, a structural absence of a writer, the same distinction the
`awaitingOperator` note above draws for a different field. Today `gemini` is the only
provider with a writer (`src/ai/gemini/interaction/prompt/errorHandler.js`,
`cooldownManager.trigger("gemini", 120)` on a detected rate limit); the other nine
`providers.<id>` keys always read `null`/`null`, as `copilot` does in the example
above. The current writer set lives in
`src/session/CooldownManager.js`'s exported `WRITABLE_PROVIDERS` — read that, not this
paragraph, for whichever provider you're checking; it is the one place this changes
if a future change gives another provider a real writer.

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
the registry drain that erases `attachedPages`'s evidence — until the flag is reset.
"Without this process itself having asked" is enforced, not assumed: the two places
this bridge deliberately closes a registered (non-auto-created) session's own stuck
tab — `ask.js` and `askOne.js`, both on a "Failed to submit prompt" error, to keep a
broken page out of the pool — mark that session `closedByBridge` immediately before
closing it, and the GC sweep / self-prune skip recording anything so marked. Without
that mark, retiring a stuck tab after an ordinary submission failure would read as a
browser-side collapse, which crew board T-023's review round caught live.

Reset condition, stated exactly because a vague one is worse than none: any session —
pool hit or cold boot — that finishes `SessionManager.createSession()` successfully,
which includes running `startNewChat()` against its page. Not "a brand-new session" —
a **pool hit** resets it too, deliberately, because a session handed back out of the
warm pool never touches the cold-boot path (`Creator.js`) at all, and a caller cannot
be left reading "collapsed" while the bridge is already serving working turns from
the pool underneath it.

A caller polling before a batch, with `sessions: 0` and `attachedPages: 0` on both a
healthy idle bridge and one whose pages were just killed underneath it, can tell the
two apart here: `null` on the healthy bridge, a timestamp on the collapsed one. Costs
nothing per poll — both values `/api/ping` reads for this field are already
maintained synchronously elsewhere; the endpoint makes no new `await` against the
browser. Blind spot: it can only fire once a dead session is actually _discovered_
(GC tick or an access attempt) — a collapse nothing has touched yet is invisible here
too, same as `attachedPages`, until something touches it or the next GC tick runs.

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
- `imageAttached: false`, plus `imageAttachedCause` and `warning` fields — something
  about attaching the image did not go as planned, for one of five distinct reasons
  (`imageAttachedCause`, below). **Treat the response as text-only in this case** — the
  model may answer fluently about an image it never received.
- Field absent — the turn carried no image at all (nothing to confirm). A request that
  included an image never gets a bare `success: true` with this field absent — one of
  the two states above always applies instead (crew board T-004).

**`imageAttachedCause` used to not exist, and `imageAttached: false` used to mean less
than it looked like it meant (crew board T-038).** Thirteen different sites across this
codebase could produce it, for reasons as different as "this provider has no upload path
at all" and "a file was handed to the provider's composer and may well have landed, but
nothing confirmed it before the bridge gave up waiting" — one boolean plus one constant
warning string could not tell those apart, and every `imageAttached: false` row recorded
before T-038 (including the one turn that ever refuted this flag — `zai`, a correct COUNT
and COLOR on a turn recorded `imageAttached: false`) is unattributable as a result and
always will be; the cause was never computed for it. `imageAttachedCause` is present
exactly when `imageAttached` is `false`, and is one of:

- `unconfirmed` — a file WAS handed to the provider's composer (an input accepted it, or
  a real OS file-chooser did) but no visible evidence confirmed it landed within the
  verification window. **This is the one worth treating differently from the rest**: it
  is the only value consistent with an image that actually arrived — everything else
  below means the image was never offered to the provider by any means this turn tried.
- `not_offered` — nothing on the provider's page accepted the file: no matching input, no
  attachment button.
- `no_upload_path` — this provider/engine has no image-upload path at all; the image was
  never even attempted.
- `text_only_retry` — a retry inside the turn (a stall retry, a rate-limit retry, a chat
  rotation, a post-cooldown retry, an operator-typed manual answer) re-sent the prompt as
  text only; any image from the original turn does not survive that resend.
- `upload_error` — something threw that isn't one of the classified outcomes above (an
  unexpected page/automation failure).

`warning` is now a function of `imageAttachedCause` (`src/ai/shared/uploadOutcome.js`,
`describeUploadFailure`) instead of one constant sentence — the old sentence ("could not
be confirmed as attached to the provider's composer") was true for `unconfirmed` and
false for `no_upload_path` / `text_only_retry`, where nothing was ever offered to a
composer to begin with.

Per `reports/vision-probe/after-ask.json` (the T-001 measurement), only `gemini`,
`deepseek`, `grok` and `copilot` — 4 providers — can be verified as receiving an image on
a given turn. `chatgpt` is NOT in that set: the same run recorded it as `SEES_NO` with
`imageAttached: false`, i.e. it answered fluently without ever having seen the picture —
exactly the failure mode this section exists to catch, not an exception to it.

`chatgpt` still is not in the set, but not for the reason the T-001 run alone would
suggest. Crew board T-018, three pinned turns 2026-08-22 (bridge commit `f293d113`,
`serverProvenance: "verified"` on all three, same `fixtureSha256` on all three, confirming
a deterministic fixture), got 2 of 3 `PASS` with a correct `COUNT` and `COLOR`, both via
`imageAttachedEvidence.strategy: "direct_input"` — the hidden `input[type="file"]`
(uploadFile.js's Strategy 1), not the attach-button click. The third was `SEES_NO`,
`imageAttachedCause: "not_offered"`: Strategy 1 didn't confirm and Strategy 2 (the
attach-button fallback) found nothing to click either, consistent with T-042's own
established ~1/3-to-2/3 raciness for this exact path. Strategy 2 itself — the attach
button/menu click Strategy 1 would fall back to — is separately confirmed structurally
dead for `chatgpt` regardless of raciness: T-103 (commit `334652f`) traced the real click
over CDP and found it calls `window.showOpenFilePicker()`, which never raises
`Page.fileChooserOpened`, so Playwright's `waitForEvent("filechooser")` can never observe
it. So `chatgpt` CAN receive an image today, through the one path that can ever work for
it, at a measured rate too unreliable to add it to the "verified receiving" set above —
2 of 3 is not the same claim as the 4 providers that have had no observed non-rate-limit
failures across this board's sweeps (see the n=8 text-turn list below). The raciness
itself is filed separately (crew board T-127) rather than treated as fixed here.

T-127's own sample, 8 more pinned turns minutes later (same conversation/tab, bridge
restarted again to `020a9af`, `serverProvenance: "verified"` and the same
`fixtureSha256` on all eight), came back 0 of 8 `PASS` — a sharp drop from T-018's 2 of
3 immediately prior, not a contradiction of it. 7 of the 8 were `imageAttachedCause:
"unconfirmed"` (Strategy 1's `setInputFiles` did not throw, but no evidence appeared
within the 6s verify window) — a DIFFERENT cause from T-018's one `not_offered` row
(no input found at all), confirmed from each report's own `imageAttachedCause` rather
than assumed. The 8th is sharper still: `imageAttached: true` (real evidence matched,
including the `backend-api/estuary`-pattern thumbnail, `grew: true`, confirmed at 575ms
— fast enough to be a client-side blob preview rather than a network round trip) but
the model's own answer was `SEES=no`. Checking the account's upload-quota menu
(`[data-testid="composer-plus-btn"]`) right after this run showed a freshly-restarted
"Get Plus for more uploads — Or wait 20 hours to upload again", where the same menu had
read as fully open when T-018 ran minutes earlier — timing consistent with (not proven
to be caused by) the burst of 8 upload attempts re-tripping an account-level quota.
That would mean the DOM evidence this section's `imageAttached` flag relies on
(`img[src^="blob:" i]` among others) can be satisfied by a local browser-rendered
preview that does not depend on the image actually reaching the model — a possible
false-positive path distinct from every previously-documented `imageAttached` failure
mode, un-confirmed here (would need a CDP network trace of a failing attempt, T-103's
method, not run this session) and filed separately as crew board T-130 rather than
asserted.
`kimi` and
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
- **Seen to complete a turn AND read an image** (n=6): `gemini`, `deepseek`, `grok`,
  `copilot` — see the `chatgpt` correction above for why it is not a 5th — plus `kimi` and
  `mistral`, added by T-030 (commit `32ebfeb`): both need a second click to reach a file
  input at all (`kimi`'s "Add files & photos" menu item, `mistral`'s own menu equivalent),
  which `uploadFileToPage`'s new `secondClickSelector` option now expresses. Live-verified
  `imageAttached: true` with a correct or near-correct COUNT read back:
  `reports/vision-probe/t030-kimi-run1.json`, `-run2.json` (both `PASS`), `t030-mistral-run1.json`,
  `-run2.json` (both attached, COUNT off by exactly one — `WRONG` shape, not a non-attach),
  `-run3.json` (`PASS`). Negative controls (fresh chat, nothing uploaded) confirmed
  `imageAttached: false` for both: `t030-kimi-negative-control.json`,
  `t030-mistral-negative-control.json`. See the corrected passage below (previously here:
  "`kimi` and `mistral` genuinely do not attach") for what was wrong before this fix.

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
`mistral` needed a menu click before any file input existed at all (`kimi`'s composer opens
an "Add files & photos" submenu, `mistral` has no `input[type="file"]` anywhere in the DOM
until some other interaction reveals one) — a different gap from a blind selector, and one
`uploadFileToPage` had no way to express until T-030 gave it a `secondClickSelector` option
(commit `32ebfeb`): a spec can now name a menu item to click after the attach button, before
the file chooser. Both are live-verified attaching with it —
`reports/vision-probe/t030-kimi-run1.json`, `-run2.json`, `t030-mistral-run1.json`,
`-run2.json`, `-run3.json`, negative controls in `t030-kimi-negative-control.json` and
`t030-mistral-negative-control.json` — see the `n=6` list above. `perplexity`
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
even a hidden node that becomes visible. `qwen` is a confirmed no with its own distinct
cause — naming a selector is not possible here because nothing appeared for one to name.
`kimi` and `mistral` are NOT in this group any more: T-030 (commit `32ebfeb`, above) gave
both a working second-click path, so the image-capable count is six providers, not the four
bespoke ones alone. As the corpus stands now, as of `c674de8`, running `node
scripts/ia-grade.mjs` gives the generic path's `imageAttached` as 6 `true` of 29 recorded
turns (23 `false`) — not 1 of 24 (T-017's own count, since superseded by T-030's new turns)
and not 0 of 21 (the founding "0 of 21" measurement, kept above as the number that started
T-017, not a live count — same treatment as before). The 6 `true` rows split into two very
different kinds: `reports/vision-probe/t014-zai-run1.json` is the reverted `.chip-scroll`
fix's own output, kept as an accurate record of what THAT code produced at the time, not a
claim about the current tree (the code that produced it no longer exists); the other 5 —
`t030-kimi-run1.json`, `-run2.json`, `t030-mistral-run1.json`, `-run2.json`, `-run3.json` —
are current code, live-verified, and stay true on a re-run today. Of the 23 `false` rows,
`perplexity` and `qwen`'s are confirmed correct no-attach (see T-022 above), `zai`'s remain
unconfirmed either way, and `kimi`/`mistral`'s 12 (4 and 8) are ALL pre-T-030 runs, correct
for the code that produced them (no second-click path existed yet) — `t006-kimi-run2.json`,
`-run3.json`, `-run4.json`, `t014-kimi-run1.json`, `after-ask.json`,
`result-ask-mistral.json`, `t005-mistral-run1.json`, `-run2.json`, `-run3.json`,
`t005-mistral-v2-run1.json`, `-run2.json`, `-run3.json`. Each provider's T-030 negative
control (`t030-kimi-negative-control.json`, `t030-mistral-negative-control.json` — fresh
chat, nothing uploaded, correctly `false` under the CURRENT code) is real evidence too, but
is NOT one of the 23: both files are flat objects with no `results` array, so
`ia-grade.mjs`'s row loop (`for (const r of j.results || [])`) never iterates them at all —
they don't add to its graded rows OR its skip count, they simply aren't rows in this tally.
None of the 23 is known to be wrong the way the pre-revert `zai` fix would have made its
false rows appear.

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
`data` / `turnIndex` / `sessionAgeMs` (and `imageAttached` / `imageAttachedCause` /
`warning` when the request included an image — same honesty contract as `/api/ask`, see
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

**`"cooldown"` is reachable only for providers with a real cooldown writer**
(crew board T-097/T-102) — today, only `gemini`
(`src/ai/gemini/interaction/prompt/errorHandler.js`, on a detected rate limit).
The current list lives in `src/session/CooldownManager.js`'s exported
`WRITABLE_PROVIDERS`; for every other provider, `cooldownManager.check()`
returns `{active: null}` and this `reason` can never be produced, by
construction, not by account behaviour. A genuinely rate-limited call on eight
of those nine surfaces as `reason: "rate_limited"` instead — a different code
for a different mechanism, not the same fact under two names — set from
`err.rateLimited`. **Only four of those eight have a detector of their own**:
`chatgpt`, `deepseek` and `grok` each have a dedicated poll-time check on
their own page (`interaction/prompt/poll.js` — chatgpt, grok;
`interaction/prompt/poll/waiter.js` — deepseek); `kimi` has a real phrase in
its own spec (`src/ai/generic/specs.js`, `rateLimit: "Too many people are
chatting with Kimi"`), checked by the generic path's own per-provider gate
(`src/ai/generic/interaction.js`). (`gemini` is not one of the nine — it sets
`err.rateLimited` from the same writer named above, `errorHandler.js` — but
sits outside this count since it is already covered by its own `"cooldown"`
first.)

**`qwen`, `zai`, `mistral` and `perplexity` have none** — their `rateLimit`
spec field is `null`, so that per-provider gate never runs for them. What
covers them instead is `src/ai/shared/promptWorkflow.js`'s own shared text
match, and it is two independent routes, not one:

- **Route A** — reached only after the poll has stalled or timed out. Tests
  an early extraction of the page against one combined regex
  (`/messages?\s+are\s+too\s+frequent|rate\s+limit|too\s+many\s+requests/i`).
- **Route B** — reached on a **normally-completed** response, no stall at
  all. Tests the full extracted text against three separate regexes
  (`/messages? are too frequent/i`, `/rate limit/i`, `/too many requests/i`).
  A generic provider that answers promptly with a throttle notice in the
  body produces `reason: "rate_limited"` through this route alone.

**The two routes are not the same test.** Route A tolerates arbitrary
whitespace between words (`\s+`); route B requires a literal single space.
A notice wrapped across a line break, or padded with a non-breaking space,
can match route A and miss route B. This is current behaviour, documented
as-is rather than reconciled — narrowing route A or loosening route B would
be a change to a live detection path with no captured real-world miss to
justify either direction.

For all four, a throttle notice worded outside those phrases surfaces as
`reason: "stalled"` or the raw underlying error message — the same
fallthrough this section already describes for copilot below.

**`copilot` is the ninth, and has no rate-limit
detection of any kind** (checked: it does not go through `runPromptWorkflow`,
and nothing under `src/ai/copilot/` sets `err.rateLimited` or matches a
rate-limit message) — a genuine copilot throttle falls through to
`reason: "stalled"` or the raw underlying error message, neither of which
names it as a rate limit either. Re-check this list against the code before
trusting it, the same way `WRITABLE_PROVIDERS` above is the thing to re-check,
not this sentence, if either set ever changes. Counting `"cooldown"`
occurrences per provider still reads nine structural zeros as nine
well-behaved providers; counting `"rate_limited"` occurrences instead moves
the same misreading onto one provider narrower — copilot's own structural
zero on THAT code, specifically, would read as copilot never rate-limiting,
when what it actually means is that copilot has nothing that would ever say
so either way.

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

**"Skipped without being asked" is gemini-only today** (crew board T-097/T-102)
— `skipTier()`'s only input is `cooldownManager`, which has one writer
(`WRITABLE_PROVIDERS` in `src/session/CooldownManager.js`). For the other nine
providers there is no cooldown to skip in advance; a rate limit already seen on
a previous turn is rediscovered at full turn cost on the next request, and the
chain finds out mid-turn the same way it always has — "dropped mid-turn when it
rate-limits" is the general case for those nine, not a fallback path.

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

**Both `503 STALLED` responses carry an `attempted` array** — a per-provider
record of what the chain tried before giving up (checked: a `200` success
never carries it, and neither does any other error status this route
returns). Real bodies, one per path — `rateLimited` and `requestId` are on
both (`requestId` is assigned before any branch runs and `sendError`
appends it whenever it is defined), `retryAfter` only on the exhausted one:

A tier's own turn stalled, tier 0 in this example (`attempted` empty — see
below):

```json
{
  "success": false,
  "error": "STALLED",
  "stalled": true,
  "rateLimited": false,
  "attempted": [],
  "requestId": "a1b2c3d4-5678-90ab-cdef-1234567890ab"
}
```

The whole chain was exhausted:

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
  "requestId": "a1b2c3d4-5678-90ab-cdef-1234567890ab"
}
```

On the exhausted response, `rateLimited` is computed from `attempted`
itself — `true` only if at least one entry's `outcome` is `"rate limit"`,
`false` when every tier was skipped for cooldown and none ever rate-limited
(a real case: a chain that is entirely on cooldown reaches this response
with `attempted` reading all `"cooldown"` and `rateLimited: false`).

The two `503`s are different failures and `attempted` means something
slightly different on each:

- **A tier's own turn stalled.** `attempted` lists whichever EARLIER tiers
  were skipped (cooling down), rate-limited, or failed to resolve a
  session — each with somewhere further to go at the time — before the
  chain reached the one that stalled. Stalling itself never falls through
  to a further tier, so this response can fire even on tier 0, with
  `attempted` empty.
- **The whole chain was exhausted.** This is reachable only one way: the
  LAST tier in the chain was skipped for being on cooldown — a last tier
  that instead rate-limits or fails to resolve a session has nowhere left
  to fall through to, so it returns its own status immediately and never
  reaches this response. Every EARLIER tier got here the same three ways
  a tier can leave the loop without ending it: skipped (cooling down),
  rate-limited with a further tier to try, or failed to resolve a session
  with a further tier to try. `attempted` covers all of them, in order,
  ending with the final tier's `"cooldown"`.

**`outcome` is not drawn from the `reason` vocabulary above, even where a
token looks the same.** Three call sites write it, three different ways:

- `"cooldown"` — `skipTier()` fired for this tier. The string happens to
  match `/api/ask-all`'s `reason: "cooldown"` exactly, and means the same
  thing (gemini-only today — see "Skipped without being asked" above).
- `"rate limit"` (a space, not an underscore) — this tier rate-limited
  mid-turn with a further tier to fall through to. This is the SAME
  mechanism as `/api/ask-all`'s `reason: "rate_limited"`, spelled
  differently — a caller matching the literal string across both endpoints
  will not get a hit matching one against the other.
- The raw error string from session resolution — free text, drawn from
  whatever failed to open or reuse a session for that tier, with no fixed
  vocabulary at all. Do not pattern-match this one; log it.

These three spellings are current behaviour, documented as they are — not
normalised to one vocabulary here, since that would be a wire-format change
a caller may already be matching against.
