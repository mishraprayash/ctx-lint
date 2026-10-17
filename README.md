# ctx-lint

> Context linter & sync for AI coding agents.

> [!WARNING]
> Early development: `check`, `sync` and `audit` work; hardening and the first release are next. See [PLAN.md](PLAN.md) for the roadmap.

AI coding agents each read their own instruction file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, …). These files drift apart, and they rot: they point at deleted files, renamed directories, scripts that no longer exist, and packages you removed. Agents trust them anyway.

`ctx-lint` is a fast, offline CLI that never calls an LLM:

| Command | What it does |
|---|---|
| `ctx-lint check` | Finds broken file paths, missing `package.json` scripts / Make targets, and missing dependencies in instruction files. Output looks like ESLint, and it exits non-zero on errors for CI. |
| `ctx-lint sync` | Compiles one source of truth (`.context/rules/*.md`) into every agent's native format. |
| `ctx-lint audit` | Estimates token cost per agent and warns when the always-on context is over budget. |

## Quick start

```bash
npx ctx-lint check
```

```
CLAUDE.md
   7:24  error    Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard.ts"?        path-exists
  13:42  error    Script "test:e2e" is not defined in package.json. Available: build, lint, test.  script-exists
  15:40  error    Make target "migrate" not found in Makefile. Available: build, clean.            make-target-exists
   24:8  warning  "zod" is referenced as a library but isn't in any package.json.                  dependency-installed

✖ 4 problems (3 errors, 1 warning)
```

Try it on the [demo project](examples/demo). Requires Node.js ≥ 22.12.

### `check` options

| Option | |
|---|---|
| `--format <stylish\|json\|compact\|github\|sarif>` | Output format. `github` annotates PRs; `sarif` feeds code scanning. |
| `--fix` | Rewrite references to moved or mis-cased files when the fix is unambiguous. |
| `--max-warnings <n>` | Fail when there are more than `n` warnings. |
| `--quiet` | Errors only. |
| `--rule <id>=<error\|warn\|off>` | Override a rule (repeatable). |
| `--no-deps` | Skip the dependency check. |
| `--dump-refs` | Show what ctx-lint found in each file (add `--debug` for what it ignored, and why). |

Exit codes: `0` no errors, `1` errors (or too many warnings), `2` usage or config error.

Rules: [path-exists](docs/rules/path-exists.md) · [path-case](docs/rules/path-case.md) ·
[glob-matches](docs/rules/glob-matches.md) · [link-anchor](docs/rules/link-anchor.md) ·
[script-exists](docs/rules/script-exists.md) · [make-target-exists](docs/rules/make-target-exists.md) ·
[bin-exists](docs/rules/bin-exists.md) · [package-manager-mismatch](docs/rules/package-manager-mismatch.md) ·
[dependency-installed](docs/rules/dependency-installed.md) · [frontmatter-valid](docs/rules/frontmatter-valid.md) ·
[unused-disable](docs/rules/unused-disable.md)

Silence a line with `<!-- ctx-lint-disable-next-line path-exists -- reason -->`.

## Sync: one source of truth

Write rules once in `.context/rules/*.md`:

```md
---
description: API route conventions
globs: ["src/api/**/*.ts"]   # omit for rules that always apply
---
- Validate every request body with `zod`.
```

```bash
npx ctx-lint init --import   # turn your existing CLAUDE.md, AGENTS.md, Cursor/Copilot rules into sources
npx ctx-lint sync            # write each agent's native files
npx ctx-lint sync --check    # in CI: fail if generated files are stale or edited by hand
```

| Agent | Always-applied rules | Path-scoped rules |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/rules/*.md` with `paths` |
| AGENTS.md (Codex, opencode, Amp, …) | `AGENTS.md` | sections, or nested `AGENTS.md` |
| Cursor | `.cursor/rules/*.mdc` (`alwaysApply: true`) | `.cursor/rules/*.mdc` with `globs` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/instructions/*.instructions.md` with `applyTo` |
| Windsurf / Devin (opt-in) | `.windsurf/rules/*.md` (`always_on`) | `trigger: glob` |

`sync` only touches content it generated. In single files it writes between
`<!-- ctx-lint:begin -->` / `<!-- ctx-lint:end -->` markers, so hand-written notes around them
survive. It refuses to overwrite anything else without `--force`, and `--dry-run` shows the diff.
See [docs/targets.md](docs/targets.md) for every format detail.

## Audit: token budgets

```bash
npx ctx-lint audit
```

```
  Agent           Always-on  Conditional   Budget  Status
  Claude Code         3,412        1,180    3,000  ✖ over by 412
  Cursor              1,950        2,640    2,500  ✔
```

`audit` shows what each agent loads on every request vs. only sometimes (it follows Claude's
`@imports`, and knows Cursor and Copilot also read `AGENTS.md`). It also lists the largest
sections and content duplicated across files, and projects the numbers after `sync`. It exits 1
over budget. The default tokenizer needs no dependencies; its median error against o200k is 3%.
See [docs/audit.md](docs/audit.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
