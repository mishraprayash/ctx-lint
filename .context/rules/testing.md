---
description: How tests and fixtures are organized
globs: ["test/**"]
---

- Every false positive gets a case in `test/unit/parsers/classify.cases.ts` and a line in
  `test/fixtures/false-positives/CLAUDE.md` before it's fixed.
- Fixtures contain intentional problems and are excluded from this repo's own `check`.
- Compiler output is snapshotted in `test/unit/syncer/__snapshots__/`; delete a snapshot and rerun
  `pnpm test` to regenerate it, then review the diff.
- Tests that write files copy a fixture into a temp directory first.
