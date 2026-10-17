# Project guide

Everything in this file looks like a reference but isn't one. `ctx-lint check` must report
nothing here. Every false positive we fix gets a line in this file.

## API

- Endpoints live under `/api/v1/`; fetch a user with `GET /users/:id`.
- Responses are `application/json`; images are `image/svg+xml` or `image/png`.
- Return `res.json()` from handlers, never `res.send()`. Log with `console.log` sparingly.
- The dev server runs on `localhost:3000` (or `127.0.0.1:3000`); docs are at
  `https://example.com/docs/api` and `www.example.com`.
- Webhooks come from `github.com/org/repo`; email `team@example.com` for access.

## Placeholders

- Put new modules in `path/to/module/` and name them `<feature>.ts`.
- Config lives in `~/.config/app/settings.json` or `$HOME/.apprc`; on Windows
  `%APPDATA%\app` or `C:\Users\me\app`.
- Template variables look like `{{name}}` and `${VERSION}`.
- Example layout: `foo/bar.ts`, `your-app/src/`, `my-component.tsx`, `src/.../deep.ts`.
- System tools are in `/usr/local/bin` and `/etc/hosts`.

## Git

- Branch from `origin/main` into `feature/my-change` or `fix/typo`; never push `HEAD~1`.
- Tags are `v1.2.3`, versions use `^18.2.0` and `2.0.0-beta.1`, dates are `1/2/2024`.

## Conventions

- Name files in `kebab-case`, variables in `camelCase`, columns in `snake_case`.
- Use `async`/`await`, prefer `interface` over `type`, and turn on `strict` mode.
- Use `pnpm`, not `npm`. Use `const`, never `var`.
- Use the `verbose` flag when debugging; `true`/`false` are booleans, `and/or` is fine.
- Use `Next.js` and `Node.js` APIs; `React` components go in `.tsx` files, logic in `.ts`.
- Avoid `moment`; it is heavy.
- Run `git status` before committing and `docker compose up` for services.
- Use `turbo run build` in CI; `echo "npm run nope"` prints a string.

```ts
// Example code is not checked, except for package imports.
import { helper } from './helpers';
import { cn } from '@/lib/utils';
import fs from 'node:fs';
const routes = ['/users/:id', 'path/to/file'];
```

```console
$ git log --oneline
> fp-fixture@1.0.0 build
> tsc -p .
```

```json
{ "scripts": { "deploy": "npm run nope" } }
```

```bash
cat <<EOF > .env.local
npm run not-a-command
EOF
```
