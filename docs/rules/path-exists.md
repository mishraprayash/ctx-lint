# path-exists

**Default:** error · **Fixable:** yes (when the file was moved and its new location is unique)

Files and directories referenced in instruction files must exist.

```md
- Auth guards live in `src/auth/guards/`.   <!-- ✖ if the directory was renamed -->
```

## How paths are resolved

1. `./x` and `../x`: relative to the instruction file only.
2. `/x`: the repo root.
3. Everything else: the repo root, then the instruction file's directory.
4. Bare file names (`package.json`, `Makefile`): anywhere in the repo.
5. A path whose first segment doesn't exist (`components/Button.tsx`) also matches a deeper path ending in it (`src/components/Button.tsx`).
6. Markdown links resolve relative to the file they're in, like on GitHub.

A path written with a trailing `/` must be a directory.

## Not reported

- Paths matching `check.ignorePaths` (default: `dist/**`, `build/**`, `coverage/**`, `node_modules/**`, `.env*`).
- Missing paths that `.gitignore` would ignore (`.env.local`, `out/`): local or generated files.
- URLs, placeholders (`path/to/file`, `<id>`), routes (`/users/:id`), MIME types and similar look-alikes. See [the classifier](../../PLAN.md#53-classification-candidate--reference).
- Medium-confidence references (no extension, e.g. `src/auth`) are reported as warnings, not errors.

## Suggestions

When the same file name exists elsewhere, ctx-lint suggests it (*"Did you mean …?"*). If it's
the only match, `--fix` rewrites the reference. Otherwise it suggests near-miss names next to
where the path should be.
