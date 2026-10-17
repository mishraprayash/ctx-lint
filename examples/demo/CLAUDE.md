# Demo project

This file has intentional context rot, so `ctx-lint check` has something to catch.

## Layout

- Auth guards live in `src/auth/guards/`.
- The HTTP server is `src/server.ts`.
- Deploy with `./scripts/deploy.sh`.

## Commands

- Run the end-to-end tests with `npm run test:e2e`.
- Build with `pnpm build` (or `make build`).
- Apply database migrations with `make migrate`.

```bash
pnpm install
pnpm test
```

## Conventions

- Use `zod` for validation.
- The server is built with `express`.
- See the [API docs](https://example.com/a/b) for details.
- Placeholders like `path/to/file` and `<id>` are ignored, as are MIME types like `application/json`.
