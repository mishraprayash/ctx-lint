# ctx-lint demo

A tiny project whose `CLAUDE.md` has intentional context rot:

| In `CLAUDE.md` | Problem |
|---|---|
| `src/auth/guards/` | Renamed to `src/auth/guard.ts` |
| `./scripts/deploy.sh` | Deleted |
| `npm run test:e2e` | No such script, and the repo uses pnpm |
| `make migrate` | No such Makefile target |
| Use `zod` for validation | Not a dependency |
| `https://example.com/a/b`, `path/to/file`, `<id>`, `application/json` | Ignored: not references |

The source rule `.context/rules/api.md` is scoped to `src/api/**/*.ts`, which matches nothing.

Run it from the repository root:

```bash
pnpm build && node dist/cli.js --cwd examples/demo check
```

The output is in [`expected-output.txt`](expected-output.txt), and an end-to-end test keeps it
up to date. Try `--format json`, `--format sarif`, `--format github` or `--dump-refs` too.
