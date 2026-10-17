# package-manager-mismatch

**Default:** warn

Commands should use the repo's package manager. It's detected from `packageManager` in the root
`package.json`, or from a single lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`,
`bun.lock`). With several lockfiles the repo is ambiguous and nothing is reported.

```md
- Run tests with `npm test`.   <!-- ⚠ in a pnpm repo: agents will mix package managers -->
```
