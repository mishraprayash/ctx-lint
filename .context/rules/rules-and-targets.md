---
description: Adding or changing lint rules and agent targets
globs: ["src/linter/**", "src/targets/**", "docs/**"]
---

- A new lint rule needs `docs/rules/<id>.md` (starting with `# <id>` and `**Default:** <severity>`)
  and an entry in `src/linter/rules/index.ts`; a test fails otherwise. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Vendor formats change: before touching a target adapter, check the vendor docs and update
  [docs/targets.md](docs/targets.md) with the URL and the date you checked.
