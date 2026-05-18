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
  "prompt": "Your prompt text"
}
```

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

## Self‑Healing Automation

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

| Param | Required | Description |
|-------|----------|-------------|
| `url` | Yes | HTTP/HTTPS URL to capture |

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
