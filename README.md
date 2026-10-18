# ctx-lint

> Lint, sync and budget the instruction files of AI coding agents.

> [!WARNING]
> Pre-release: `check`, `sync` and `audit` work, and the first npm release is next. Until then,
> [build it from source](docs/getting-started.md#requirements). See [PLAN.md](PLAN.md) for the roadmap.

Coding agents each read their own instruction files: `CLAUDE.md`, `AGENTS.md`,
`.cursor/rules/*.mdc`, `.github/copilot-instructions.md` and more. These files go wrong in three ways:

- **They rot.** Code moves, but the instructions still point at deleted files, renamed
  directories, scripts that no longer exist and libraries you removed. Agents follow them anyway.
- **They drift apart.** Every agent wants its own format, so the same rules are copied and edited
  separately.
- **They grow.** Always-loaded instructions cost tokens on every request.

`ctx-lint` is a fast, offline CLI for all three. It never calls a network service or a language
model.

| Command | What it does |
|---|---|
| [`ctx-lint check`](docs/check.md) | Checks every path, glob, link, script, Make target and library the files mention against the repo. Output looks like ESLint's, and it can fail CI. |
| [`ctx-lint sync`](docs/sync.md) | Compiles one source of truth (`.context/rules/*.md`) into each agent's native format. |
| [`ctx-lint audit`](docs/audit.md) | Estimates the token cost per agent and fails when the always-on context is over budget. |

## Check

```bash
ctx-lint check
```

```
CLAUDE.md:7:24  error  path-exists
  Path "src/auth/guards/" does not exist.
    7 │ - Auth guards live in `src/auth/guards/`.
      │                        ^^^^^^^^^^^^^^^^
  → Did you mean "src/auth/guard.ts"?

CLAUDE.md:13:34  warning  package-manager-mismatch
  This repo uses pnpm (pnpm-lock.yaml), but this command uses npm.
   13 │ - Run the end-to-end tests with `npm run test:e2e`.
      │                                  ^^^^^^^^^^^^^^^^
  → Use `pnpm run test:e2e`.  (fixable)

CLAUDE.md:15:40  error  make-target-exists
  Make target "migrate" not found in Makefile. Available: build, clean.
   15 │ - Apply database migrations with `make migrate`.
      │                                        ^^^^^^^

✖ 7 problems (4 errors, 3 warnings) in 2 files
  1 problem can be fixed safely: ctx-lint check --fix
  For the rest, hand a task to your coding agent: ctx-lint check --fix --format agent
```

That's part of the [demo project](examples/demo)'s report: `ctx-lint --cwd examples/demo check`.

- **Fixes you can trust:** suggestions are always real paths (the rename from your git history,
  the same file elsewhere, or a near-miss name). `--fix` applies only the ones with a single right
  answer, then re-checks them and undoes any that didn't work.
- **The rest goes to your agent:** `ctx-lint check --fix --format agent` writes a task for your
  coding agent. It lists each remaining problem with its line and the real candidates, and
  forbids invented paths. The agent is done when `ctx-lint check` passes.
- **Built for CI:** output as `stylish`, `compact`, `json`, `github` (PR annotations) or `sarif`.
- **Few false positives:** only references it's sure about can be errors. Anything less certain
  is a warning or skipped. On ten large public repos, about 1 in 10 errors was a false positive;
  see [how accurate it is](docs/accuracy.md).
- **Easy to silence:** `<!-- ctx-lint-disable-next-line path-exists -- reason -->`, or
  `check.ignorePaths` in the config.

## Sync

Write each rule once:

```md
---
description: API route conventions
globs: ["src/api/**/*.ts"]   # omit for rules that always apply
---
- Validate every request body with `zod`.
```

```bash
ctx-lint init --import   # turn your existing CLAUDE.md, AGENTS.md, Cursor and Copilot rules into sources
ctx-lint sync            # write each agent's files
ctx-lint sync --check    # in CI: fail if generated files are stale or were edited by hand
```

| Agent | Always-applied rules | Path-scoped rules |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/rules/*.md` with `paths` |
| AGENTS.md (Codex, opencode, Amp, …) | `AGENTS.md` | sections, or nested `AGENTS.md` |
| Cursor | `.cursor/rules/*.mdc` (`alwaysApply: true`) | `.cursor/rules/*.mdc` with `globs` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/instructions/*.instructions.md` with `applyTo` |
| Windsurf / Devin (opt-in) | `.windsurf/rules/*.md` (`always_on`) | `trigger: glob` |

`sync` only touches content it generated, and hand-written notes around it are kept. This
repository's own `CLAUDE.md` and `AGENTS.md` are generated this way.

## Audit

```bash
ctx-lint audit
```

```
  Agent           Always-on  Conditional   Budget  Status
  Claude Code         3,412        1,180    3,000  ✖ over by 412
  Cursor              1,950        2,640    2,500  ✔
```

`audit` shows what each agent loads on every request and what only sometimes. It follows
Claude's `@imports`, and knows that Cursor and Copilot also read `AGENTS.md`. It also lists the
largest sections and duplicated content.

## Documentation

- [Getting started](docs/getting-started.md)
- Guides: [check](docs/check.md), [sync](docs/sync.md), [audit](docs/audit.md) and [CI](docs/ci.md).
- Reference: [configuration](docs/configuration.md), [CLI](docs/cli.md), [rules](docs/README.md#rules),
  [agent formats](docs/targets.md) and the [programmatic API](docs/api.md).
- [How it works, and how accurate it is](docs/accuracy.md)

Requires Node.js 22.12 or newer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
