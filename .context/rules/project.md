---
description: What ctx-lint is and how the repository is laid out
alwaysApply: true
priority: -10
---

ctx-lint is an offline CLI that lints (`check`), compiles (`sync`) and budgets (`audit`) the
instruction files of AI coding agents. [PLAN.md](PLAN.md) is the source of truth for the design;
record changed decisions in its Decision Log.

## Layout

- `src/cli/`: commander wiring only. Business logic lives elsewhere and is exported from `src/api/index.ts`.
- `src/parsers/`: markdown → candidates (`extract.ts`) → typed references (`classify/`).
- `src/linter/`: the rule engine (`engine.ts`) and one file per rule in `src/linter/rules/`.
- `src/targets/`: one adapter per agent format; `src/syncer/` plans and writes generated files.
- `src/auditor/`: token estimates and per-agent baselines. `src/manifests/`: package.json, Makefile, justfile, tsconfig.
- `test/unit/` mirrors `src/`; `test/fixtures/` holds small repos; `examples/demo/` is the documented demo.

## Commands

- `pnpm verify` runs everything CI runs: lint, typecheck, unit and e2e tests.
- `pnpm test` for unit tests, `pnpm test:e2e` to build and run the CLI tests.
- `pnpm lint:fix` formats with Biome. `pnpm schema` after changing `src/config/schema.ts`.
- Try the CLI with `node dist/cli.js --cwd examples/demo check` after `pnpm build`.
