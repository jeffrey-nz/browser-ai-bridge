# Contributing

Thank you for your interest in contributing to browser-ai-bridge!

## Before you start

The core challenge with this project is that it automates **live web interfaces** that change without notice. Contributions that improve selector resilience, add new providers, or improve failure detection are especially welcome.

## Development setup

```bash
git clone https://github.com/jeffrey-nz/browser-ai-bridge.git
cd browser-ai-bridge
npm install
cp .env.example .env
npm start   # starts Chrome and the interactive setup wizard
```

## Running the audit

After setup, verify everything works:

```bash
npm run audit              # interactive menu, all providers
npm run audit -- --provider chatgpt   # single provider
npm run audit -- --ci      # non-interactive, all providers
```

Pass/fail screenshots land in `reports/`. If a provider fails, check the `*-failure.html` snapshot and the probe output for which selectors are broken.

## Fixing broken selectors

1. Run `npm run audit` to identify which step and which provider fails
2. Check `reports/<provider>-failure.html` for the live DOM
3. Update the relevant locator file in `src/ai/<provider>/locators.js`
4. Re-run the audit to verify
5. Or run `npm run audit:fix` to get LLM-generated suggestions based on the failure HTML

## Adding a new provider

1. Create `src/ai/<provider>/locators.js` exporting a `<PROVIDER>_LOCATORS` object with at minimum: `newChatBtn`, `inputBox`, `sendBtn`, `stopBtn`, `responseBlock`, `doneSignal`
2. Create `src/ai/<provider>/session.js`, `index.js`, and `interaction/` mirroring an existing provider (e.g. `src/ai/grok/`)
3. Add the provider to `src/config/providers.js` and `src/startup/providers.js`
4. Register the audit entry in `src/audit/providers.js`
5. Run the full audit to verify

## Code style

- ESM modules throughout (`"type": "module"`)
- No TypeScript — plain JS with JSDoc where helpful
- Format with `prettier` (config in `.prettierrc`)
- No comments explaining _what_ code does — only comments explaining _why_ (non-obvious constraints, workarounds, invariants)

## Pull requests

- Keep PRs focused: one concern per PR
- Include a CHANGELOG entry under `[Unreleased]`
- If you're fixing a broken selector for a specific provider, mention which provider, which step failed, and briefly how you found the correct selector

## Selector stability tips

AI chat interfaces update frequently. When writing selectors:

- Prefer `data-testid` attributes over class names (more stable)
- Use `aria-label` as a fallback (semantic, less likely to change)
- Avoid deep structural selectors (`.parent > .child > .grandchild`) — brittle
- Combine selectors with `, ` to cover multiple UI versions simultaneously

## Reporting bugs

Open an issue with:

- Which provider failed
- The step name (from audit output)
- The `reports/<provider>-failure.html` file (strip personal info from chat content if any)
- Node.js version and OS
