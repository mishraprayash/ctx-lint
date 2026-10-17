# Targets

How `ctx-lint sync` compiles `.context/rules` for each agent, and which files `check` and
`audit` read. Vendors change these formats. Every format detail lives in one adapter under
`src/targets/`, and this page records what each one was checked against.

Rule kinds (from source frontmatter): **always** (`alwaysApply: true`), **scoped** (has `globs`),
**on-demand** (`alwaysApply: false` with only a `description`; the agent decides when to load it).

## Claude Code: `claude`

*Checked 2026-10-17 against <https://code.claude.com/docs/en/memory>.*

- Reads `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md` in the working directory and its
  ancestors at launch. Nested `CLAUDE.md` files in subdirectories load on demand. `@path` imports
  are expanded (relative to the importing file, up to four hops).
- `.claude/rules/**/*.md`: rules **without** `paths` load at launch; rules **with** `paths`
  (a YAML list or comma-separated string of globs) load only when Claude reads or edits a
  matching file. `paths` is the only frontmatter key Claude reads.
- Without a `CLAUDE.md`, Claude Code reads `AGENTS.md` instead.

| Kind | `scopedRules: "rules"` (default) | `"sections"` | `"nested"` |
|---|---|---|---|
| always | inlined in `CLAUDE.md` | same | same |
| scoped | `.claude/rules/<id>.md` with `paths:` | a section in `CLAUDE.md` | `<dir>/CLAUDE.md` for the glob's static directory (falls back to a section) |
| on-demand | a section in `CLAUDE.md` (Claude has no description-based loading) | same | same |

## AGENTS.md: `agents`

*Checked 2026-10-17 against <https://agents.md>.*

Plain markdown, no frontmatter. The nearest `AGENTS.md` in the directory tree takes precedence.
Read by Codex, Jules, opencode, Amp, Cursor, Copilot's coding agent, Windsurf/Devin, Gemini CLI
(when configured), Zed, Junie and others.

| Kind | `scopedRules: "sections"` (default) | `"nested"` |
|---|---|---|
| always | inlined in `AGENTS.md` | same |
| scoped | a section per glob | `<dir>/AGENTS.md` for the glob's static directory |
| on-demand | a section | same |

## Cursor: `cursor`

*Checked 2026-10-17 against <https://cursor.com/docs/context/rules>.*

- Project rules are `.cursor/rules/**/*.mdc`. Plain `.md` files there are ignored.
- Frontmatter: `description` (string), `globs` (**one comma-separated string, not a YAML list**),
  `alwaysApply` (boolean). With `alwaysApply: true`, the others are ignored.
- Types: Always (`alwaysApply: true`), Apply to Specific Files (`globs`), Apply Intelligently
  (`description` only), Apply Manually (neither).
- Cursor also reads `AGENTS.md` (root and nested). The legacy `.cursorrules` file isn't mentioned
  in the current docs; `check` still reads it.

`sync` writes one `.mdc` file per rule, with all three keys in Cursor's own order. Globs that
start with a YAML indicator (`*.ts`) are written double-quoted so the frontmatter stays valid
YAML. The docs only show unquoted examples, so check this if Cursor stops matching them.

## GitHub Copilot: `copilot`

*Checked 2026-10-17 against <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>.*

- `.github/copilot-instructions.md`: repository-wide, no frontmatter.
- `.github/instructions/**/*.instructions.md`: path-specific. `applyTo` is a quoted,
  comma-separated glob string (`"**/*.ts,**/*.tsx"`). Optional `excludeAgent`
  (`"code-review"` or `"cloud-agent"`).
- Copilot's coding agent also reads `AGENTS.md`, or a root `CLAUDE.md` / `GEMINI.md`.

| Kind | `scopedRules: "instructions"` (default) | `"sections"` |
|---|---|---|
| always | inlined in `copilot-instructions.md` | same |
| scoped | `.github/instructions/<id>.instructions.md` with `applyTo` | a section |
| on-demand | a section | same |

## Windsurf / Devin Desktop: `windsurf` (off by default)

*Checked 2026-10-17 against <https://docs.devin.ai/desktop/cascade/memories> (formerly docs.windsurf.com).*

- Workspace rules are `.devin/rules/*.md` (preferred) or `.windsurf/rules/*.md` (kept for
  backward compatibility), one rule per file, **at most 12,000 characters each**.
- Frontmatter `trigger`: `always_on`, `model_decision` (uses `description`), `glob` (uses
  `globs`) or `manual`.
- The legacy `.windsurfrules` file is still read. `AGENTS.md` is read as well.

`sync` writes to `.windsurf/rules` by default, which old and new versions both read. Set
`targets.windsurf.outputDir` to `.devin/rules` if you only use Devin Desktop. A generated
file over 12,000 characters is reported as a warning.
