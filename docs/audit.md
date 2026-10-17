# `ctx-lint audit`

Estimates how many tokens each agent spends on your instruction files before it reads a single
line of your code, and fails when an agent's **always-on** context is over budget.

```
  Agent           Always-on  Conditional   Budget  Status
  Claude Code           135           16       50  ✖ over by 85
  Cursor                 51           16    2,500  ✔
```

- **Always-on:** loaded on every request.
- **Conditional:** loaded only when relevant: path-scoped rules, nested files, rules the agent
  picks by description.

## What counts, per agent

| Agent | Always-on | Conditional |
|---|---|---|
| Claude Code | root `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules` without `paths`, and everything they `@import` (up to four levels). `AGENTS.md` only when there's no `CLAUDE.md`. | nested `CLAUDE.md`, `.claude/rules` with `paths` |
| AGENTS.md agents | root `AGENTS.md` | nested `AGENTS.md` |
| Cursor | `.mdc` rules with `alwaysApply: true`, `.cursorrules`, root `AGENTS.md` | other `.mdc` rules |
| GitHub Copilot | `.github/copilot-instructions.md`, `*.instructions.md` with `applyTo: "**"`, root `AGENTS.md` | other `*.instructions.md` |
| Windsurf / Devin | `trigger: always_on` rules, `.windsurfrules`, root `AGENTS.md` | other rules |

Frontmatter isn't counted: agents strip it before loading a rule. Agents that only appear
because they read another agent's file (e.g. Cursor reading `AGENTS.md`) are listed when they're
an enabled target in `.context/config.json`. The sources for these rules are in
[targets.md](targets.md).

The report also shows:

- **Largest always-on sections**, split at H1/H2 headings (`--per-section` lists them all).
- **Duplicated content:** paragraphs, list items and code blocks that appear in more than one
  file the same agent always loads, so it pays for them twice. A common case is the same rules
  in Cursor `.mdc` files and in `AGENTS.md`.
- **Large files** over `audit.fileWarn` tokens (default 1,500).
- **After `ctx-lint sync`:** when `.context/rules` exists and syncing would change the numbers,
  the same table for the files `sync` would write, so you can see the impact first.

## Budgets

```jsonc
// .context/config.json
{ "audit": { "budget": { "default": 2500, "claude": 3000 }, "fileWarn": 1500 } }
```

`--budget <n>` overrides every agent. `audit` exits 1 when any agent is over budget, unless
`--warn-only` is passed. `--format json` prints the whole result.

## Accuracy

Token counts are **estimates**. Anthropic doesn't publish Claude's tokenizer, and each vendor's
tokenizer differs a little.

- `--tokenizer heuristic` (default, no dependencies): splits text the way BPE tokenizers pre-split
  it and applies weights fitted against OpenAI's o200k tokenizer. Measured on 191 markdown files
  (326k tokens; this repo's docs plus the READMEs of its dependencies): **median error 3.1%,
  90% of files within 7.2%**, with no systematic bias (−0.3%), so totals across several files
  are closer still. Text that is mostly emoji or rare symbols can be off by more (18.5% for the
  worst file in the corpus, a table of Unicode symbols). `pnpm calibrate` refits the weights and
  reports these numbers, including for a held-out third of the corpus.
- `--tokenizer o200k` / `cl100k`: exact counts for those OpenAI tokenizers, via the optional
  `gpt-tokenizer` package (`npm i -D gpt-tokenizer`).

Both are proxies for "how much context does this cost", which is what the budget is for.
Claude's tokenizer is different, so its counts will differ too. That can't be measured offline,
so leave some headroom in Claude budgets.
