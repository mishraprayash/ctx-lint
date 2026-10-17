# glob-matches

**Default:** warn

Globs must match at least one file. This covers globs in text (`` `src/**/*.vue` ``) and in rule
frontmatter: Cursor and Windsurf `globs`, and Copilot `applyTo`. A rule scoped to a glob that
matches nothing is never applied.

Frontmatter globs are relative to the repo root. For nested rule folders
(`apps/web/.cursor/rules/x.mdc`) they are also tried relative to the folder that holds them.
Globs into unwalked directories (`node_modules`, `dist`) or `check.ignorePaths` are skipped.
