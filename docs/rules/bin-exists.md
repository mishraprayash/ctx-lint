# bin-exists

**Default:** warn

Executables run with `npx x`, `pnpm exec x`, `bunx x` or `npm exec x` should be installed
(`node_modules/.bin`) or provided by a declared dependency or a package in the repo.

Not reported:

- When `node_modules` isn't installed and no dependency is known to provide the binary: we can't tell.
- `npx create-…`, `npx pkg@version`, `npx -p pkg …` and `npx --yes …`, which download on purpose.
