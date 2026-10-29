# Changelog

All notable changes to `ctx-lint`. The format follows [Keep a Changelog](https://keepachangelog.com),
and versions follow [Semantic Versioning](https://semver.org). Before 1.0, minor versions may
change behavior; the JSON report format only changes additively.

## 0.1.0 (2026-10-29)

The first release.

- **`ctx-lint check`** lints the instruction files of AI coding agents: `CLAUDE.md`,
  `AGENTS.md`, `.claude/rules`, Cursor `.mdc` rules, Copilot instructions and Windsurf / Devin
  rules. It checks file paths, globs, links and anchors, `package.json` scripts, Make and just
  targets, executables, libraries and frontmatter against the repository, offline. Only
  references it's sure about can be errors.
  - Suggestions come from git history and the repository, and are always real paths.
  - `--fix` applies fixes with one right answer and re-checks them, undoing any that didn't
    work.
  - `--format agent` writes a task for a coding agent for the rest.
  - Output formats: `stylish`, `compact`, `json`, `github`, `sarif` and `agent`.
- **`ctx-lint sync`** compiles `.context/rules/*.md` into each agent's native format. It only
  touches content it generated, and `--check` catches stale or hand-edited files in CI.
  `ctx-lint init --import` turns existing instruction files into source rules.
- **`ctx-lint audit`** estimates the always-on token cost per agent, lists the largest sections
  and duplicated content, and fails over budget.
- **`ctx-lint explain <rule>`** prints a rule's documentation.
- A GitHub Action (`uses: mishraprayash/ctx-lint@v0`) and a programmatic API.
