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
5. Or run `npm run audit:fix`: it copies a prompt with the failure report and HTML snapshot to your clipboard, to paste into any LLM for suggested selectors

## Adding a new provider

**A plain chat site** (type, send, wait, read the answer) needs only a spec: add
an entry to `GENERIC_SPECS` in `src/ai/generic/specs.js` with its `id`, `name`,
`url`, `urlMatch`, `maxPromptChars` and `locators`. Provider config, the login
wizard, session creation and the audit all read that table, so nothing else
needs registering. Copy an existing entry such as `kimi`.

**A site that needs custom behaviour** (mode switching, uploads, unusual
streaming) gets its own implementation:

1. Copy `src/ai/deepseek/` (the most complete example) to `src/ai/<provider>/`. Its `locators.js` exports `<PROVIDER>_LOCATORS` with at least `newChatBtn`, `inputBox`, `sendBtn`, `stopBtn`, `responseBlock` and `doneSignal`
2. Register the provider class in `src/session/Creator.js`
3. Add it to `src/config/providers.js` (name, `maxPromptChars`) and `src/startup/providers.js` (URL and ready selector for the login wizard)
4. If it has modes, map them in `PROVIDER_MODES` in `src/ai/modes.js`
5. Add an audit entry in `src/audit/providers.js`
6. Run `npm run audit -- --provider <name>` to verify

## Code style

- ESM modules throughout (`"type": "module"`)
- No TypeScript — plain JS with JSDoc where helpful
- Format with `prettier` (config in `.prettierrc`)
- No comments explaining _what_ code does — only comments explaining _why_ (non-obvious constraints, workarounds, invariants)

## Pull requests

- Keep PRs focused: one concern per PR
- Include a CHANGELOG entry under `[Unreleased]`
- Run what CI runs: `npx prettier --check "src/**/*.js" "tests/**/*.js" "scripts/**"`, `npm test`, `npm run check:reachable` and `npm run check:docs`
- If you're fixing a broken selector for a specific provider, mention which provider, which step failed, and briefly how you found the correct selector

## Releasing

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading, and update the compare links at the bottom
2. `npm version X.Y.Z --no-git-tag-version` to bump `package.json` and the lockfile
3. Commit and push to `main`, then either push a tag
   (`git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`) or run the Release
   workflow by hand on `main` with `vX.Y.Z`, which creates the tag there
4. The Release workflow publishes a GitHub release whose notes are that
   version's `CHANGELOG.md` section. Running it for an existing tag publishes or
   refreshes that tag's release
5. `npm publish` separately, from a clean checkout of the tag

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
