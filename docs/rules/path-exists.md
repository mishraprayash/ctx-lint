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
7. Paths written like imports (`src/auth/guard`, `@/components/Button`) also match the usual
   module files: `.ts`, `.tsx`, `.js`, … and `index.*`.
8. Aliases come from `compilerOptions.paths` in the root `tsconfig.json` / `jsconfig.json`
   (following local `extends`), and from `check.aliases`, which wins.
9. Source rules in `.context/rules` resolve from the repo root, because that's where their
   content ends up after `sync`.

A path written with a trailing `/` must be a directory.

## Not reported

- Paths matching `check.ignorePaths` (default: `dist/**`, `build/**`, `coverage/**`, `node_modules/**`, `.env*`).
- Missing paths that `.gitignore` would ignore (`.env.local`, `out/`): local or generated files.
- URLs, placeholders (`path/to/file`, `<id>`), routes (`/users/:id`), MIME types and similar look-alikes. See [the classifier](../../PLAN.md#53-classification-candidate--reference).
- Medium-confidence references (no extension, e.g. `src/auth`) are reported as warnings, not errors.

## Suggestions

1. If git history shows the path was renamed or moved (directories too, and chains of renames),
   the message says so: *"It was renamed to `src/security/guard.ts` in a1b2c3d."* `--fix` applies it.
2. Otherwise, if the same file name exists elsewhere, it's suggested (*"Did you mean …?"*), and
   `--fix` applies it when there's exactly one.
3. Otherwise, near-miss names next to where the path should be are suggested.
