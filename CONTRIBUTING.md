# Contributing

Thanks for helping improve PDF Extractor. Bug reports, fixes, documentation and ideas are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Never attach or commit real documents. Use the synthetic fixtures in `fixtures/`, or generate a new synthetic one with `tools/fixtures` (see below).

## Setting up

You need Node.js 22 and pnpm 10.

```
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

The app opens at `http://localhost:5173/pdf-extractor/`. Use Chrome or Edge for the full app (folder access).

## Checks

Every change must pass the same checks as CI:

```
pnpm lint        # ESLint and Prettier
pnpm typecheck   # TypeScript in every package
pnpm test        # unit tests (engine, PDF adapter, workspace, styles)
pnpm build       # production build
pnpm e2e         # end-to-end tests in Chromium
```

`pnpm format` fixes formatting. `pnpm screenshots` captures every screen in light and dark mode into `docs/screenshots/`, for reviewing visual changes.

## House rules

These keep the app safe, consistent and easy to change. `AGENTS.md` has the full list.

- **Privacy first.** The app makes no network requests beyond its own files: no analytics, CDNs or remote fonts. Documents never leave the browser.
- **Colours** live only in `apps/web/src/styles/tokens.css`, with a value for light and dark mode. Text must pass WCAG AA contrast; a test checks this.
- **Interface text** lives only in `apps/web/src/strings.ts`, in plain English and sentence case.
- **The engine** (`packages/engine`) is pure TypeScript with no browser APIs, so it also runs in Node.
- **Accessibility:** everything works from the keyboard, and axe reports no violations (the end-to-end tests check every screen).
- No `eval`, `new Function` or `innerHTML` with document text.

## Fixtures and goldens

Fixture PDFs are generated, never made by hand:

```
pnpm fixtures   # regenerate fixtures/pdf (deterministic)
pnpm goldens    # regenerate fixtures/expected from the reference templates
```

Review the golden diff by hand before committing it, because it's what the tests compare against.

## Pull requests

- Keep each pull request to one change, with a clear description of what and why.
- Add or update tests with the change.
- Record notable design decisions in `docs/DECISIONS.md`.
- By contributing, you agree that your contribution is licensed under this project's MIT licence.
