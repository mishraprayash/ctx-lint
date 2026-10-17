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
CLAUDE.md
   7:24  error    Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard.ts"?        path-exists
  13:42  error    Script "test:e2e" is not defined in package.json. Available: build, lint, test.  script-exists
  15:40  error    Make target "migrate" not found in Makefile. Available: build, clean.            make-target-exists
   24:8  warning  "zod" is referenced as a library but isn't in any package.json.                  dependency-installed

✖ 4 problems (3 errors, 1 warning)
```

Each line shows where the reference is, what's wrong, the likeliest fix and the rule that
reported it. Run `ctx-lint explain <rule>` to read what a rule checks.

Fix what's safe to fix automatically (files that moved or changed case, when there's exactly one
candidate):

```bash
ctx-lint check --fix
```

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
