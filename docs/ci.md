# Running ctx-lint in CI

`ctx-lint` is built for CI: it's offline and deterministic, and its exit codes are meaningful.

| Command | Fails (exit 1) when |
|---|---|
| `ctx-lint check` | there are errors (or more than `--max-warnings` warnings) |
| `ctx-lint sync --check` | a generated file is missing, stale or edited by hand, or a source rule is invalid |
| `ctx-lint audit` | an agent's always-on context is over budget (`--warn-only` to never fail) |

All three exit 2 for usage or configuration errors.

Warnings never fail `check` unless you pass `--max-warnings`. Since uncertain references are
reported as warnings at most ([confidence](check.md#confidence)), CI fails only on problems
`ctx-lint` is sure about.

## GitHub Actions

The shortest setup uses the `ctx-lint` action:

```yaml
name: Agent instructions
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ctx-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0   # full history, so suggestions can say "renamed to X in a1b2c3d"
      - uses: mishraprayash/ctx-lint@v0
```

It sets up Node.js 22 and runs `ctx-lint check --format github`, which annotates the pull
request. Its inputs:

| Input | Default | |
|---|---|---|
| `args` | `check --format github` | What to run, e.g. `sync --check` or `audit` |
| `version` | `latest` | The ctx-lint version from npm. Pin it (`0.1.0`) for reproducible runs |
| `working-directory` | `.` | Where to run |
| `node-version` | `22` | Node.js version (22.12 or newer) |

Run the other checks as extra steps with different `args`:

```yaml
      - uses: mishraprayash/ctx-lint@v0
        with:
          args: sync --check   # only if you use .context/rules
      - uses: mishraprayash/ctx-lint@v0
        with:
          args: audit
```

Or call the CLI directly:

```yaml
name: Agent instructions
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ctx-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0   # full history, so suggestions can say "renamed to X in a1b2c3d"
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx ctx-lint check --format github
      - run: npx ctx-lint sync --check   # only if you use .context/rules
      - run: npx ctx-lint audit
```

`--format github` turns each problem into an annotation on the changed line in the pull request.
`fetch-depth: 0` is optional. With a shallow clone, `ctx-lint` still works, but can't suggest
renames from history.

### Code scanning (SARIF)

To list problems in the repository's Security tab instead:

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v5
  - uses: actions/setup-node@v5
    with:
      node-version: 22
  - run: npx ctx-lint check --format sarif > ctx-lint.sarif || true
  - uses: github/codeql-action/upload-sarif@v3
    with:
      sarif_file: ctx-lint.sarif
```

## Other CI systems

Any CI can use the exit code. Use `--format compact` for plain logs, or `--format json` to post-process:

```bash
npx ctx-lint check --format json > ctx-lint.json
```

The JSON shape is versioned and stable ([check.md](check.md#output-formats)).

## Before every commit

With [pre-commit](https://pre-commit.com), a local hook:

```yaml
repos:
  - repo: local
    hooks:
      - id: ctx-lint
        name: ctx-lint
        entry: npx ctx-lint check
        language: system
        pass_filenames: false
        files: '(CLAUDE|AGENTS)\.md$|\.mdc$|copilot-instructions\.md$|\.instructions\.md$|^\.context/'
```

Or with a plain git hook (`.git/hooks/pre-commit`, or your hook manager):

```bash
npx ctx-lint check --quiet && npx ctx-lint sync --check
```

`--quiet` shows errors only, which keeps the hook short.

## Adopting it in an existing repo

On a large repo, the first run may report a lot. One way in:

1. Run `ctx-lint check --fix` to apply the unambiguous fixes, then review the diff.
2. Fix or suppress what's left ([handling false positives](check.md#handling-false-positives)).
3. Turn on the CI step. If you want to start with errors only, add `--quiet`. To also stop
   warnings from growing, add `--max-warnings <current count>`.
