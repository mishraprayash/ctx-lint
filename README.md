# ctx-lint

> Context linter & sync for AI coding agents.

> [!WARNING]
> Early development. The commands below are planned and not implemented yet. See [PLAN.md](PLAN.md) for the roadmap.

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

Requires Node.js ≥ 22.12.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
