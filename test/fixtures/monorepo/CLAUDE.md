# Acme monorepo

## Scripts

- Start the web app with `pnpm --filter @acme/web dev`.
- Storybook: `pnpm --filter web storybook`.
- The mobile app: `pnpm --filter mobile dev`.
- Build everything with `pnpm -r build`.
- Unit tests: `pnpm test:unit`. Not `pnpm test:units`.
- Lint with `npm run lint`.
- Generate components with `pnpm exec ui-gen`; type-check with `npx tsc`.

## Make and just

- Deploy with `make deploy`; docs are built with `make docs`.
- Release with `just release`, publish with `just publish`.

## Files

- Read the [getting started guide](docs/guide.md#getting-started) and the [install notes](docs/guide.md#install).
- The guide is `docs/Guide.md`.
- The app lives in `apps/web/src/App.tsx`; buttons are in `components/Button.tsx`.
- The header is `apps/web/src/Header.tsx`.
- Local secrets go in `.env.local`.

## Libraries

- UI is built with `react`.
- Use `zod` for validation.

<!-- ctx-lint-disable-next-line path-exists -- removed next sprint -->
- Legacy code: `legacy/old.ts`.

<!-- ctx-lint-disable-next-line script-exists -->
- This line is fine: `pnpm test:unit`.

<!-- ctx-lint-disable-next-line made-up-rule -->
- Nothing to see here.
