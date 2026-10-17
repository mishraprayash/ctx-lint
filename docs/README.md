# ctx-lint documentation

`ctx-lint` keeps the instruction files of AI coding agents correct, consistent and small. It's an
offline CLI: no network, no language model.

## Guides

- [Getting started](getting-started.md): install, first run, CI in five minutes.
- [`check`](check.md): what's checked, confidence levels, `--fix`, suppressing false positives,
  output formats.
- [`sync`](sync.md): one source of truth in `.context/rules`, compiled for every agent.
- [`audit`](audit.md): token cost per agent and always-on budgets.
- [CI](ci.md): GitHub Actions, SARIF, pre-commit, adopting it in an existing repo.

## Reference

- [Configuration](configuration.md): every key in `.context/config.json`.
- [CLI](cli.md): every command, option and exit code.
- [Rules](#rules): one page per rule (also `ctx-lint explain <rule>`).
- [Targets](targets.md): each agent's file format, as checked against vendor docs.
- [Programmatic API](api.md): use `check`, `sync` and `audit` from JavaScript.
- [How it works and how accurate it is](accuracy.md): offline design, false positives, measured
  results.

## Rules

| Rule | Default | Checks |
|---|---|---|
| [path-exists](rules/path-exists.md) | error | Referenced files and directories exist |
| [path-case](rules/path-case.md) | error | Paths match the case on disk |
| [glob-matches](rules/glob-matches.md) | warn | Globs (in text and frontmatter) match at least one file |
| [link-anchor](rules/link-anchor.md) | warn | `#anchor` links point to a real heading |
| [script-exists](rules/script-exists.md) | error | `package.json` scripts exist where they run |
| [make-target-exists](rules/make-target-exists.md) | error | Make targets and just recipes exist |
| [bin-exists](rules/bin-exists.md) | warn | Executables run with `npx` / `pnpm exec` are installed |
| [package-manager-mismatch](rules/package-manager-mismatch.md) | warn | Commands use the repo's package manager |
| [dependency-installed](rules/dependency-installed.md) | warn | Libraries the docs tell agents to use are declared |
| [frontmatter-valid](rules/frontmatter-valid.md) | error | Frontmatter is valid for that agent's format |
| [generated-file-modified](rules/generated-file-modified.md) | warn | Generated content wasn't edited by hand |
| [unused-disable](rules/unused-disable.md) | warn | Disable comments still suppress something |
