<!-- ctx-lint:begin hash=174760379925 -->
<!-- Generated from .context/rules. Do not edit inside this block: change the source rules and run `npx ctx-lint sync`. -->

## What ctx-lint is and how the repository is laid out

ctx-lint is an offline CLI that lints (`check`), compiles (`sync`) and budgets (`audit`) the
instruction files of AI coding agents. [PLAN.md](PLAN.md) is the source of truth for the design;
record changed decisions in its Decision Log.

### Layout

- `src/cli/`: commander wiring only. Business logic lives elsewhere and is exported from `src/api/index.ts`.
- `src/parsers/`: markdown → candidates (`extract.ts`) → typed references (`classify/`).
- `src/linter/`: the rule engine (`engine.ts`) and one file per rule in `src/linter/rules/`.
- `src/targets/`: one adapter per agent format; `src/syncer/` plans and writes generated files.
- `src/auditor/`: token estimates and per-agent baselines. `src/manifests/`: package.json, Makefile, justfile, tsconfig.
- `test/unit/` mirrors `src/`; `test/fixtures/` holds small repos; `examples/demo/` is the documented demo.

### Commands

- `pnpm verify` runs everything CI runs: lint, typecheck, unit and e2e tests.
- `pnpm test` for unit tests, `pnpm test:e2e` to build and run the CLI tests.
- `pnpm lint:fix` formats with Biome. `pnpm schema` after changing `src/config/schema.ts`.
- Try the CLI with `node dist/cli.js --cwd examples/demo check` after `pnpm build`.

## Code conventions for the TypeScript sources

- Node.js ≥ 22.12, ESM only, TypeScript 6 (not 7: tsup's declaration bundler needs the compiler API).
- Paths inside the code are POSIX and repo-relative; convert at the edges (`src/core/paths.ts`).
- No `any`. Expected failures throw a `CtxLintError` subclass with an exit code (`src/core/errors.ts`).
- Precision over recall: when unsure whether something is a reference, skip it or make it a warning.

<!-- ctx-lint:end -->
