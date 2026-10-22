# Notes for coding agents

## Commands

```
pnpm install
pnpm lint          # ESLint + Prettier check
pnpm typecheck     # tsc in every package
pnpm test          # Vitest (engine, pdf adapter, workspace, styles)
pnpm build         # production build of apps/web
pnpm e2e           # test build + Playwright (Chromium)
pnpm fixtures      # regenerate fixture PDFs (deterministic)
pnpm goldens       # regenerate golden outputs from the reference templates
pnpm perf          # measure performance targets in Node
```

## Rules

- Read `BUILD_PLAN.md` (never edit it). Record deviations in `docs/DECISIONS.md`.
- `packages/engine` is pure TypeScript with no DOM or browser globals.
- Colours only in `apps/web/src/styles/tokens.css`; interface text only in `apps/web/src/strings.ts`.
- No network requests beyond the app's own origin. No `eval`, `new Function` or `innerHTML`.
- Synthetic fixtures only (`fixtures/`). Never commit real documents.
- Commit after each milestone as `M<n>: <summary>` once lint, typecheck, tests, build and e2e pass.

## Layout

- `packages/engine`: tokens → lines → fingerprint → fields → tables → checks → status → CSV/JSON.
- `packages/pdf`: pdf.js adapter (bytes → tokens), page rendering, OCR adapter.
- `apps/web`: Preact app, workspace layer (`src/workspace`), worker (`src/worker`), screens (`src/screens`).
- `tools/fixtures`: fixture PDF generator and golden writer.
