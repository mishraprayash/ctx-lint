# unused-disable

**Default:** warn

Reports `ctx-lint-disable` directives that didn't suppress anything, and directives that name
rules that don't exist. Stale directives hide future problems.

```md
<!-- ctx-lint-disable-next-line path-exists -- generated at build time -->
- Output goes to `generated/api.ts`.
```

Directives: `ctx-lint-disable-next-line`, `ctx-lint-disable-line`, `ctx-lint-disable` …
`ctx-lint-enable`. Each takes optional comma- or space-separated rule ids, then an optional
` -- reason`.
