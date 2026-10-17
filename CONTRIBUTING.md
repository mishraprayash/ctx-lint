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
| `pnpm ci` | Everything CI runs |

Try your local build with `node dist/cli.js <command>`.

## Ground rules

- `src/cli/` stays thin: it parses flags and calls `src/api/`. Business logic lives in its own module and is tested there.
- Paths are POSIX and repo-relative inside the code. Convert at the edges only.
- No `any`. Expected failures throw a `CtxLintError` subclass.
- **False positives are bugs.** Every fix for one adds a case to the `test/fixtures/false-positives` fixture first.

Guides for adding a rule, a target, and a manifest provider are coming with Phases 3–4.
