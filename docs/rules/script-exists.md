# script-exists

**Default:** error

Scripts run through a package manager must exist in the `package.json` that would run them:
`npm run x`, `npm test`, `pnpm x`, `pnpm --filter web x`, `yarn workspace web x`, `bun run x`,
`node --run x`.

- The script is looked up in the nearest `package.json` at or above the instruction file (or the
  directory given with `--prefix`, `-C`, `--cwd`).
- Workspace selectors (`--filter`, `-w`, `yarn workspace`) must match a package, and one of the
  matched packages must define the script.
- `-r` / `--workspaces` need some package to define it. `--if-present` is never reported.
- `pnpm x`, `yarn x` and `bun x` fall back to running a binary named `x`, so they pass if such a
  binary is installed or provided by a dependency. Those forms are medium confidence (warnings).
- If the script is missing where the command runs but another package defines it, that's a
  **warning** with a hint (e.g. `pnpm -w build`), since the command is probably run from the wrong place.
