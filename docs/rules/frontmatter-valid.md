# frontmatter-valid

**Default:** error

Frontmatter must be valid YAML and match what the format expects:

| Format | Keys |
|---|---|
| Cursor (`.cursor/rules/*.mdc`) | `description` (string), `globs` (string or list), `alwaysApply` (boolean) |
| Copilot (`.github/instructions/*.instructions.md`) | `applyTo` (string or list), `description`, `excludeAgent` |
| Windsurf (`.windsurf/rules/*.md`) | `trigger` (`always_on`, `glob`, `model_decision`, `manual`), `globs`, `description` |
| ctx-lint source rules (`.context/rules/*.md`) | `description`, `globs`, `alwaysApply`, `targets`, `priority` |

Wrong types are errors (`alwaysApply: "yes"`). Unknown keys are warnings, with a suggestion for
typos (`glob` → `globs`).

A common mistake: an unquoted glob that starts with `*` (`globs: *.ts`) is a YAML alias. Quote it:
`globs: "*.ts"`.

For source rules, `alwaysApply: false` without `globs` or a `description` is an error: no agent
would ever load that rule.

**Fix:** a key from another format that has exactly one equivalent (`globs` in a Copilot file is
`applyTo`, `globs` in a Claude rule is `paths`) is renamed by `--fix`. If the value doesn't suit
the new key, re-checking catches it and the fix is undone.
