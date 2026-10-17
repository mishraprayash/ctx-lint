# Contributing to ctx-lint

Thanks for helping out! The architecture and roadmap live in [PLAN.md](PLAN.md). Read §3 (Architecture) before making larger changes.

## Setup

Requires Node.js ≥ 22.12 and pnpm (via Corepack):

```bash
corepack enable
pnpm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm build` | Bundle to `dist/` with tsup |
| `pnpm dev` | Rebuild on change |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:e2e` | Build, then run the CLI end-to-end tests |
| `pnpm lint` / `pnpm lint:fix` | Biome lint + format check / auto-fix |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm verify` | Everything CI runs |

Try your local build with `node dist/cli.js <command>`.

## Ground rules

- `src/cli/` stays thin: it parses flags and calls `src/api/`. Business logic lives in its own module and is tested there.
- Paths are POSIX and repo-relative inside the code. Convert at the edges only.
- No `any`. Expected failures throw a `CtxLintError` subclass.
- **False positives are bugs.** Every fix for one adds a case to the `test/fixtures/false-positives` fixture first.

## Adding a lint rule

1. Create `src/linter/rules/<rule-id>.ts` exporting a `LintRule`. Implement `reference(ref, ctx)`
   for reference rules (check `ref.kind` first) or `file(file, ctx)` for whole-file checks, and
   call `ctx.report({ message, range })`. The engine handles severity, confidence (medium →
   warning), inline disables and sorting.
2. Register it in `src/linter/rules/index.ts`.
3. Add `docs/rules/<rule-id>.md` starting with `# <rule-id>` and `**Default:** <severity>`.
   A test fails if the registry and the docs disagree.
4. Add cases to a fixture (`test/fixtures/monorepo` covers every rule) and to
   `test/unit/linter/rules.test.ts`. Make sure `test/fixtures/false-positives` still reports nothing.

## Debugging a false positive

```bash
node dist/cli.js --debug check --dump-refs path/to/CLAUDE.md
```

This lists every candidate, what it was classified as and why it was ignored. Add the snippet to
`test/unit/parsers/classify.cases.ts` and `test/fixtures/false-positives/CLAUDE.md`, then fix
the classifier.

Guides for adding a sync target and a manifest provider are coming with Phase 4.
