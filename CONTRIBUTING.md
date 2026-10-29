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
| `pnpm schema` | Regenerate `schema/config.schema.json` after changing the config schema |
| `pnpm bench` | Time `check` on a synthetic 50k-file repo (target: under 2 s) |
| `pnpm calibrate` | Refit the heuristic tokenizer against o200k and print its error |
| `pnpm corpus [dir] [--limit N] [--only a/b,c/d] [--offline]` | Fetch file-tree skeletons of the public repos in `test/corpus/repos.json` (4 at a time, resumable), lint them and write a triage report. Use `--only` on repos the heuristics weren't tuned on for an unbiased check |

Try your local build with `node dist/cli.js <command>`.

This repo dogfoods ctx-lint: `CLAUDE.md`, `AGENTS.md` and `.claude/rules/` are generated from
`.context/rules`. Edit those sources and run `node dist/cli.js sync`; CI runs `check`,
`sync --check` and `audit` on the repo itself.

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

## Adding a sync target

1. Add the id to `AGENT_IDS` (`src/core/types.ts`) and a config section in `src/config/schema.ts`
   (then `pnpm schema`).
2. Create `src/targets/<id>.ts` implementing `TargetAdapter`:
   - `detect` and `isAlwaysOn`: which files the agent reads (used by `check` and `audit`);
   - `compile(rules, { config })`: return `OutputFile`s. Per-rule files set `perRule: true`
     and pass their frontmatter through `renderFrontmatter`; the generated-file header and
     managed blocks are added for you;
   - `ownedDirs`: where per-rule files go, so orphans get cleaned up.
3. Add its frontmatter format to `src/targets/frontmatter.ts` if it has one.
4. Register it in `src/targets/registry.ts`, add a case to `test/unit/syncer/compile.test.ts`
   (file snapshots), and document the format, with the vendor docs URL and the date you checked,
   in `docs/targets.md`.

## Adding a manifest provider

Manifest parsing lives in `src/manifests/` (`npm.ts`, `make.ts`, `just.ts`) and is reached
through the `Manifests` class. A new task runner (Taskfile, pyproject scripts…) adds a parser
there plus a reference kind in `src/parsers/classify/command.ts` and a rule.

## Releasing

Releases are published from GitHub Actions ([release.yml](.github/workflows/release.yml)), with
npm provenance.

1. Set `version` in `package.json`, and move the `## <version> (unreleased)` notes in
   [CHANGELOG.md](CHANGELOG.md) to `## <version> (YYYY-MM-DD)`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin main v0.1.0`.
3. The workflow checks that the tag matches `package.json`, runs `pnpm verify`, publishes to npm,
   creates the GitHub release from the changelog section, and moves the `v0` tag that the
   GitHub Action's users follow.

It needs an `NPM_TOKEN` repository secret (an npm automation token).
