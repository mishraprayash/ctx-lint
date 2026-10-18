# Getting started

This page takes you from nothing to a repo whose agent instruction files are checked in CI.
It takes about five minutes.

## Requirements

- Node.js 22.12 or newer.
- A project with at least one agent instruction file (`CLAUDE.md`, `AGENTS.md`,
  `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, …), or one you're about to write.

`ctx-lint` is not published to npm yet. Until it is, build it from source:

```bash
# in a checkout of this repository
pnpm install
pnpm build
```

Then run it with `node /path/to/ctx-lint/dist/cli.js` wherever these docs say `ctx-lint`. Once it's
published, `npx ctx-lint` will work with no install.

## 1. Check your existing files

From anywhere inside your repository:

```bash
ctx-lint check
```

`ctx-lint` finds the repository root (the nearest git root, or `--cwd <dir>`), discovers every
agent instruction file, and checks what they reference against the repo:

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

Each problem shows where it is (click `CLAUDE.md:7:24` in most terminals to open it), the line,
what's wrong, and the fix when there is one. Run `ctx-lint explain <rule>` to read what a rule
checks.

Fix what has a single right answer (moved files, case, the package manager, anchors). Each fix is
re-checked, and undone if it didn't work:

```bash
ctx-lint check --fix
```

Hand what's left to your coding agent as a task file, and ask it to follow it:

```bash
ctx-lint check --fix --format agent > ctx-lint-task.md
```

The task lists each problem with its line and the real candidates, and tells the agent never to
invent a path. It's done when `ctx-lint check` passes. See [Fixing problems](check.md#fixing-problems).

If a report is wrong, see [Handling false positives](check.md#handling-false-positives).

To try it without your own repo, use the bundled demo:

```bash
ctx-lint --cwd examples/demo check
```

## 2. See what your instructions cost

```bash
ctx-lint audit
```

This estimates how many tokens each agent loads on every request, before it has read any of your
code, and compares that with a budget (2,500 tokens by default). See [audit.md](audit.md).

## 3. (Optional) Keep one source of truth

If you use more than one agent, keep the rules in one place and generate each agent's files:

```bash
ctx-lint init --import   # turn existing CLAUDE.md, AGENTS.md, Cursor and Copilot rules into sources
ctx-lint sync --dry-run  # preview the generated files
ctx-lint sync            # write them
```

The sources live in `.context/rules/*.md`. After this, edit the sources rather than the generated
files. See [sync.md](sync.md).

Starting from scratch instead? `ctx-lint init` creates `.context/config.json` and a starter rule.

## 4. Run it in CI

```yaml
- run: npx ctx-lint check --format github   # annotates the PR
- run: npx ctx-lint sync --check            # if you use sync
- run: npx ctx-lint audit                   # fails over budget
```

See [ci.md](ci.md) for a full workflow, pre-commit hooks and SARIF upload.

## Next steps

- [check.md](check.md): what `check` looks for, confidence levels, suppressing reports.
- [configuration.md](configuration.md): every option in `.context/config.json`.
- [accuracy.md](accuracy.md): how `ctx-lint` decides what is a reference, and how often it's wrong.
