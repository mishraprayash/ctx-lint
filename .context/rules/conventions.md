---
description: Code conventions for the TypeScript sources
alwaysApply: true
---

- Node.js ≥ 22.12, ESM only, TypeScript 6 (not 7: tsup's declaration bundler needs the compiler API).
- Paths inside the code are POSIX and repo-relative; convert at the edges (`src/core/paths.ts`).
- No `any`. Expected failures throw a `CtxLintError` subclass with an exit code (`src/core/errors.ts`).
- Precision over recall: when unsure whether something is a reference, skip it or make it a warning.
